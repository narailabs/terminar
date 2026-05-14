//! Incremental OSC escape-sequence parser.
//!
//! Recognizes a small vocabulary of OSC (Operating System Command) sequences
//! that terminar intercepts and acts on, rather than passing through to
//! xterm.js as opaque bytes. Currently supported:
//!
//! - **OSC 7** — de-facto standard for a shell to report its current working
//!   directory: `ESC ] 7 ; file://HOST/PATH ST`. Used by the CWD watcher to
//!   keep `session.cwd` up to date for remote sessions.
//!
//! - **OSC 52** — de-facto standard for clipboard access:
//!   `ESC ] 52 ; <targets> ; <base64-data> ST`. Used to route "copy to
//!   clipboard" actions from tools running inside SSH sessions back to the
//!   local system clipboard. We ignore the targets field and treat any OSC
//!   52 write as clipboard. Queries (`<data>` = `?`) are ignored.
//!
//! - **OSC 7777** — terminar-specific vocabulary for actions that have no
//!   standard escape sequence: `ESC ] 7777 ; <subcommand> ; <base64-data> ST`.
//!   Subcommands currently implemented:
//!   - `open_url` — open a URL in the user's default local browser.
//!   - `edit_request` — request that the user edit a file locally. Payload
//!     after the subcommand is `<base64-id>;<base64-filename>;<base64-contents>`.
//!
//!   Unknown subcommands are silently ignored so this vocabulary can grow
//!   without breaking older clients.
//!
//! `OscParser` accepts byte chunks incrementally via [`OscParser::feed`] and
//! returns a `Vec<OscEvent>` containing every recognized event in the chunk
//! (in order). The parser is stateful across chunks so sequences that
//! straddle chunk boundaries are handled correctly. It silently ignores all
//! escape sequences it doesn't recognize.

use base64::Engine;

/// Maximum bytes the parser will buffer for a single OSC payload. Real OSC
/// payloads (cwd, short clipboard, a URL) are well under 1 KB; anything
/// larger is treated as a malformed sequence and the parser resets to idle
/// to avoid unbounded memory growth. Increase if/when OSC 52 needs to
/// handle large clipboard payloads.
const MAX_PAYLOAD_BYTES: usize = 64 * 1024;

/// A structured OSC event recognized by the parser.
///
/// Emitted by [`OscParser::feed`] when a complete, recognized OSC sequence
/// has been parsed. Unrecognized sequences emit nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OscEvent {
    /// OSC 7 — shell's current working directory.
    Cwd(String),
    /// OSC 52 — "copy to local clipboard" request. Payload is the decoded
    /// bytes of the base64 data field (NOT the base64 itself).
    ClipboardWrite(Vec<u8>),
    /// OSC 7777 `open_url` — "open this URL in the local default browser".
    OpenUrl(String),
    /// OSC 7777 `edit_request` — "edit this file locally and send it back".
    /// `id` is an opaque session-unique identifier the remote chose so it can
    /// correlate the eventual reply; `filename` is purely for display in the
    /// local UI; `contents` is the current file contents (may be empty).
    EditRequest {
        id: String,
        filename: String,
        contents: Vec<u8>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    /// Scanning for the start of an escape sequence (ESC, 0x1b).
    Idle,
    /// Saw ESC; expecting `]` to enter an OSC sequence.
    GotEsc,
    /// Inside an OSC; reading the numeric parameter (`Ps`) until `;`.
    ReadingPs,
    /// Reading the payload after `Ps;`, until BEL or ESC \.
    ReadingPayload,
    /// Inside the payload we saw ESC; expecting `\` to terminate (ST).
    PayloadGotEsc,
}

#[derive(Debug)]
pub struct OscParser {
    state: State,
    /// Accumulated numeric parameter.
    ps: u32,
    /// Payload bytes between `Ps;` and the terminator.
    payload: Vec<u8>,
}

impl Default for OscParser {
    fn default() -> Self {
        Self::new()
    }
}

impl OscParser {
    pub fn new() -> Self {
        Self {
            state: State::Idle,
            ps: 0,
            payload: Vec::new(),
        }
    }

    /// Feed a chunk of raw PTY bytes to the parser.
    ///
    /// Returns every recognized event contained in this chunk, in the order
    /// they were parsed. If the chunk contains no complete OSC sequence (or
    /// only unrecognized ones), returns an empty vector.
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<OscEvent> {
        let mut events = Vec::new();
        for &b in chunk {
            if let Some(event) = self.step(b) {
                events.push(event);
            }
        }
        events
    }

    fn reset(&mut self) {
        self.state = State::Idle;
        self.ps = 0;
        self.payload.clear();
    }

    fn step(&mut self, b: u8) -> Option<OscEvent> {
        match self.state {
            State::Idle => {
                if b == 0x1b {
                    self.state = State::GotEsc;
                }
                None
            }
            State::GotEsc => {
                if b == b']' {
                    self.state = State::ReadingPs;
                    self.ps = 0;
                    self.payload.clear();
                } else if b == 0x1b {
                    // Consecutive ESC — stay in GotEsc waiting for `]`.
                } else {
                    // Not an OSC intro — abandon.
                    self.state = State::Idle;
                }
                None
            }
            State::ReadingPs => {
                if b.is_ascii_digit() {
                    self.ps = self.ps.saturating_mul(10).saturating_add((b - b'0') as u32);
                    if self.ps > 10_000 {
                        // Absurdly large Ps — definitely garbage.
                        self.reset();
                    }
                    None
                } else if b == b';' {
                    self.state = State::ReadingPayload;
                    None
                } else if b == 0x07 {
                    // Terminator before any semicolon — no payload, nothing to emit.
                    self.reset();
                    None
                } else if b == 0x1b {
                    // Possible ESC \ terminator before semicolon — handle in payload-esc.
                    self.state = State::PayloadGotEsc;
                    None
                } else {
                    // Malformed — abandon.
                    self.reset();
                    None
                }
            }
            State::ReadingPayload => {
                if b == 0x07 {
                    let out = self.finish_payload();
                    self.state = State::Idle;
                    out
                } else if b == 0x1b {
                    self.state = State::PayloadGotEsc;
                    None
                } else {
                    if self.payload.len() < MAX_PAYLOAD_BYTES {
                        self.payload.push(b);
                    } else {
                        // Payload too large — bail and resync.
                        self.reset();
                    }
                    None
                }
            }
            State::PayloadGotEsc => {
                if b == b'\\' {
                    // ST terminator.
                    let out = self.finish_payload();
                    self.state = State::Idle;
                    out
                } else if b == b']' {
                    // New OSC introducer — restart payload accumulation.
                    self.state = State::ReadingPs;
                    self.ps = 0;
                    self.payload.clear();
                    None
                } else {
                    // Unexpected — abandon.
                    self.reset();
                    None
                }
            }
        }
    }

    fn finish_payload(&mut self) -> Option<OscEvent> {
        let payload = std::mem::take(&mut self.payload);
        match self.ps {
            7 => finish_osc7(&payload),
            52 => finish_osc52(&payload),
            7777 => finish_osc7777(&payload),
            _ => None,
        }
    }
}

/// Decode an OSC 7 payload of the form `file://HOST/PATH` where `PATH` is
/// percent-encoded. Tolerates an empty host (`file:///PATH`).
fn finish_osc7(payload: &[u8]) -> Option<OscEvent> {
    let payload_str = std::str::from_utf8(payload).ok()?;
    let rest = payload_str.strip_prefix("file://")?;
    // HOST runs until the next `/`. That `/` is the start of the path.
    let slash = rest.find('/')?;
    let encoded_path = &rest[slash..];
    let decoded = percent_decode(encoded_path.as_bytes())?;
    Some(OscEvent::Cwd(decoded))
}

/// Decode an OSC 52 payload of the form `<targets>;<base64-data>`.
/// Targets is a selector string (e.g. `c` for clipboard) that we ignore;
/// any OSC 52 write is treated as a clipboard write. Query payloads
/// (data == `?`) and empty clears (data empty) are ignored.
fn finish_osc52(payload: &[u8]) -> Option<OscEvent> {
    let payload_str = std::str::from_utf8(payload).ok()?;
    // Spec: `OSC 52 ; Pc ; Pd ST`. Find the first `;` to split targets from data.
    let semi = payload_str.find(';')?;
    let data = &payload_str[semi + 1..];
    if data.is_empty() || data == "?" {
        return None;
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .ok()?;
    Some(OscEvent::ClipboardWrite(decoded))
}

/// Decode an OSC 7777 payload of the form `<subcommand>;<base64-data>`.
/// Recognized subcommands:
/// - `open_url` — `<subcommand>;<base64-url>`.
/// - `edit_request` — `<subcommand>;<base64-id>;<base64-filename>;<base64-contents>`.
///
/// Other subcommands are silently ignored so the vocabulary can grow without
/// breaking older clients.
fn finish_osc7777(payload: &[u8]) -> Option<OscEvent> {
    let payload_str = std::str::from_utf8(payload).ok()?;
    let semi = payload_str.find(';')?;
    let subcmd = &payload_str[..semi];
    let data = &payload_str[semi + 1..];
    match subcmd {
        "open_url" => {
            let decoded = base64::engine::general_purpose::STANDARD
                .decode(data.as_bytes())
                .ok()?;
            let url = String::from_utf8(decoded).ok()?;
            Some(OscEvent::OpenUrl(url))
        }
        "edit_request" => {
            // Payload is three base64 fields separated by `;`:
            // <base64-id>;<base64-filename>;<base64-contents>
            // Base64 never contains `;`, so exactly two semicolons are expected.
            let parts: Vec<&str> = data.split(';').collect();
            if parts.len() != 3 {
                return None;
            }
            let engine = base64::engine::general_purpose::STANDARD;
            let id_bytes = engine.decode(parts[0].as_bytes()).ok()?;
            let filename_bytes = engine.decode(parts[1].as_bytes()).ok()?;
            let contents = engine.decode(parts[2].as_bytes()).ok()?;
            let id = String::from_utf8(id_bytes).ok()?;
            let filename = String::from_utf8(filename_bytes).ok()?;
            Some(OscEvent::EditRequest {
                id,
                filename,
                contents,
            })
        }
        _ => None,
    }
}

/// Percent-decode a URL byte slice into a UTF-8 String.
///
/// Returns `None` if the input contains a malformed percent sequence (e.g.
/// `%` at end of string or non-hex digits) or if the decoded bytes are not
/// valid UTF-8.
fn percent_decode(encoded: &[u8]) -> Option<String> {
    let mut out = Vec::with_capacity(encoded.len());
    let mut i = 0;
    while i < encoded.len() {
        let b = encoded[i];
        if b == b'%' {
            if i + 2 >= encoded.len() {
                return None;
            }
            let h1 = (encoded[i + 1] as char).to_digit(16)?;
            let h2 = (encoded[i + 2] as char).to_digit(16)?;
            out.push((h1 * 16 + h2) as u8);
            i += 3;
        } else {
            out.push(b);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- OSC 7 ----

    fn bel_osc7(host: &str, path: &str) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(b"\x1b]7;file://");
        v.extend_from_slice(host.as_bytes());
        v.extend_from_slice(path.as_bytes());
        v.push(0x07);
        v
    }

    fn st_osc7(host: &str, path: &str) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(b"\x1b]7;file://");
        v.extend_from_slice(host.as_bytes());
        v.extend_from_slice(path.as_bytes());
        v.extend_from_slice(b"\x1b\\");
        v
    }

    fn last_cwd(events: &[OscEvent]) -> Option<&str> {
        events.iter().rev().find_map(|e| match e {
            OscEvent::Cwd(p) => Some(p.as_str()),
            _ => None,
        })
    }

    #[test]
    fn parses_simple_bel_terminated() {
        let mut p = OscParser::new();
        let events = p.feed(&bel_osc7("host", "/tmp"));
        assert_eq!(last_cwd(&events), Some("/tmp"));
    }

    #[test]
    fn parses_simple_st_terminated() {
        let mut p = OscParser::new();
        let events = p.feed(&st_osc7("host", "/var/log"));
        assert_eq!(last_cwd(&events), Some("/var/log"));
    }

    #[test]
    fn parses_empty_host() {
        let mut p = OscParser::new();
        let events = p.feed(&bel_osc7("", "/usr/local"));
        assert_eq!(last_cwd(&events), Some("/usr/local"));
    }

    #[test]
    fn parses_percent_encoded_space() {
        let mut p = OscParser::new();
        let events = p.feed(&bel_osc7("host", "/tmp/space%20dir"));
        assert_eq!(last_cwd(&events), Some("/tmp/space dir"));
    }

    #[test]
    fn parses_percent_encoded_utf8() {
        // "café" → c a f é, where é is %C3%A9 in UTF-8
        let mut p = OscParser::new();
        let events = p.feed(&bel_osc7("host", "/tmp/caf%C3%A9"));
        assert_eq!(last_cwd(&events), Some("/tmp/café"));
    }

    #[test]
    fn split_across_two_chunks() {
        let mut p = OscParser::new();
        let full = bel_osc7("host", "/home/user/projects");
        let (a, b) = full.split_at(10);
        assert!(p.feed(a).is_empty());
        let events = p.feed(b);
        assert_eq!(last_cwd(&events), Some("/home/user/projects"));
    }

    #[test]
    fn split_across_three_chunks() {
        let mut p = OscParser::new();
        let full = st_osc7("host", "/a/b/c");
        assert!(p.feed(&full[..5]).is_empty());
        assert!(p.feed(&full[5..15]).is_empty());
        let events = p.feed(&full[15..]);
        assert_eq!(last_cwd(&events), Some("/a/b/c"));
    }

    #[test]
    fn split_in_st_terminator() {
        let mut p = OscParser::new();
        let full = st_osc7("host", "/x");
        let split = full.len() - 1;
        assert!(p.feed(&full[..split]).is_empty());
        let events = p.feed(&full[split..]);
        assert_eq!(last_cwd(&events), Some("/x"));
    }

    #[test]
    fn non_osc_bytes_pass_through() {
        let mut p = OscParser::new();
        assert!(p.feed(b"hello world\nno escapes here").is_empty());
        assert!(p.feed(b"\x1b[31mred\x1b[0m").is_empty()); // CSI colors
    }

    #[test]
    fn unknown_osc_ignored() {
        let mut p = OscParser::new();
        // OSC 2 (set title) should be ignored.
        assert!(p.feed(b"\x1b]2;My Title\x07").is_empty());
        // OSC 0 (icon + title) should be ignored.
        assert!(p.feed(b"\x1b]0;Window\x07").is_empty());
    }

    #[test]
    fn preceded_and_followed_by_output() {
        let mut p = OscParser::new();
        let mut buf = b"prompt> ".to_vec();
        buf.extend(bel_osc7("host", "/home/dev"));
        buf.extend_from_slice(b"$ next command\n");
        let events = p.feed(&buf);
        assert_eq!(last_cwd(&events), Some("/home/dev"));
    }

    #[test]
    fn two_consecutive_osc7_returns_both() {
        let mut p = OscParser::new();
        let mut buf = bel_osc7("host", "/first");
        buf.extend(bel_osc7("host", "/second"));
        let events = p.feed(&buf);
        // Both events should be emitted, in order.
        let cwds: Vec<&str> = events
            .iter()
            .filter_map(|e| match e {
                OscEvent::Cwd(p) => Some(p.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(cwds, vec!["/first", "/second"]);
    }

    #[test]
    fn malformed_missing_file_prefix_rejected() {
        let mut p = OscParser::new();
        assert!(p.feed(b"\x1b]7;/no/scheme\x07").is_empty());
    }

    #[test]
    fn malformed_missing_terminator_buffers_until_next() {
        let mut p = OscParser::new();
        // Payload without terminator — parser keeps buffering.
        assert!(p.feed(b"\x1b]7;file://host/first").is_empty());
        // Eventually a terminator and a fresh OSC 7 arrive.
        let events = p.feed(b"\x07\x1b]7;file://host/second\x07");
        assert_eq!(last_cwd(&events), Some("/second"));
    }

    #[test]
    fn malformed_percent_rejected() {
        let mut p = OscParser::new();
        assert!(p.feed(&bel_osc7("host", "/tmp/%ZZ")).is_empty());
    }

    #[test]
    fn oversized_payload_resets_parser() {
        let mut p = OscParser::new();
        let mut huge = b"\x1b]7;file://host".to_vec();
        huge.extend(std::iter::repeat(b'/').take(MAX_PAYLOAD_BYTES + 100));
        huge.push(0x07);
        assert!(p.feed(&huge).is_empty());
        let events = p.feed(&bel_osc7("host", "/after"));
        assert_eq!(last_cwd(&events), Some("/after"));
    }

    #[test]
    fn interleaved_with_csi_sequences() {
        let mut p = OscParser::new();
        let mut buf = b"\x1b[2J\x1b[H".to_vec(); // clear + home
        buf.extend(bel_osc7("host", "/work"));
        buf.extend_from_slice(b"\x1b[1;32mgreen\x1b[0m");
        let events = p.feed(&buf);
        assert_eq!(last_cwd(&events), Some("/work"));
    }

    #[test]
    fn percent_decode_direct() {
        assert_eq!(percent_decode(b"/tmp/foo").as_deref(), Some("/tmp/foo"));
        assert_eq!(
            percent_decode(b"/tmp/space%20dir").as_deref(),
            Some("/tmp/space dir")
        );
        assert_eq!(percent_decode(b"/tmp/%"), None);
        assert_eq!(percent_decode(b"/tmp/%Z0"), None);
    }

    // ---- OSC 52 ----

    fn osc52_bel(targets: &str, data_b64: &str) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(b"\x1b]52;");
        v.extend_from_slice(targets.as_bytes());
        v.push(b';');
        v.extend_from_slice(data_b64.as_bytes());
        v.push(0x07);
        v
    }

    fn b64(s: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(s.as_bytes())
    }

    #[test]
    fn parses_osc52_clipboard_write() {
        let mut p = OscParser::new();
        let events = p.feed(&osc52_bel("c", &b64("hello")));
        assert_eq!(events.len(), 1);
        match &events[0] {
            OscEvent::ClipboardWrite(data) => assert_eq!(data, b"hello"),
            other => panic!("unexpected event: {:?}", other),
        }
    }

    #[test]
    fn parses_osc52_with_multi_char_target() {
        // Spec allows multiple target chars, e.g. `pc` for primary + clipboard.
        let mut p = OscParser::new();
        let events = p.feed(&osc52_bel("pc", &b64("world")));
        assert_eq!(events.len(), 1);
        match &events[0] {
            OscEvent::ClipboardWrite(data) => assert_eq!(data, b"world"),
            other => panic!("unexpected event: {:?}", other),
        }
    }

    #[test]
    fn parses_osc52_st_terminated() {
        let mut p = OscParser::new();
        let mut buf = b"\x1b]52;c;".to_vec();
        buf.extend_from_slice(b64("st-data").as_bytes());
        buf.extend_from_slice(b"\x1b\\");
        let events = p.feed(&buf);
        assert_eq!(events.len(), 1);
        match &events[0] {
            OscEvent::ClipboardWrite(data) => assert_eq!(data, b"st-data"),
            other => panic!("unexpected event: {:?}", other),
        }
    }

    #[test]
    fn osc52_query_is_ignored() {
        // `?` is the spec's query form — not a write.
        let mut p = OscParser::new();
        assert!(p.feed(b"\x1b]52;c;?\x07").is_empty());
    }

    #[test]
    fn osc52_empty_data_is_ignored() {
        // Empty payload clears the clipboard in the spec; we ignore it.
        let mut p = OscParser::new();
        assert!(p.feed(b"\x1b]52;c;\x07").is_empty());
    }

    #[test]
    fn osc52_invalid_base64_is_ignored() {
        let mut p = OscParser::new();
        // `!!!` is not valid base64 — the event is dropped silently.
        assert!(p.feed(b"\x1b]52;c;!!!\x07").is_empty());
    }

    #[test]
    fn osc52_split_across_chunks() {
        let mut p = OscParser::new();
        let full = osc52_bel("c", &b64("chunked-data"));
        let mid = full.len() / 2;
        assert!(p.feed(&full[..mid]).is_empty());
        let events = p.feed(&full[mid..]);
        assert_eq!(events.len(), 1);
        match &events[0] {
            OscEvent::ClipboardWrite(data) => assert_eq!(data, b"chunked-data"),
            other => panic!("unexpected event: {:?}", other),
        }
    }

    #[test]
    fn osc52_utf8_payload() {
        let mut p = OscParser::new();
        let events = p.feed(&osc52_bel("c", &b64("héllo 世界")));
        assert_eq!(events.len(), 1);
        match &events[0] {
            OscEvent::ClipboardWrite(data) => {
                assert_eq!(std::str::from_utf8(data).unwrap(), "héllo 世界")
            }
            other => panic!("unexpected event: {:?}", other),
        }
    }

    // ---- OSC 7777 ----

    fn osc7777_open_url(url: &str) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(b"\x1b]7777;open_url;");
        v.extend_from_slice(b64(url).as_bytes());
        v.push(0x07);
        v
    }

    #[test]
    fn parses_osc7777_open_url() {
        let mut p = OscParser::new();
        let events = p.feed(&osc7777_open_url("https://example.com/oauth?code=abc"));
        assert_eq!(events.len(), 1);
        match &events[0] {
            OscEvent::OpenUrl(url) => {
                assert_eq!(url, "https://example.com/oauth?code=abc")
            }
            other => panic!("unexpected event: {:?}", other),
        }
    }

    #[test]
    fn osc7777_unknown_subcommand_ignored() {
        let mut p = OscParser::new();
        let mut buf = b"\x1b]7777;unknown_action;".to_vec();
        buf.extend_from_slice(b64("whatever").as_bytes());
        buf.push(0x07);
        assert!(p.feed(&buf).is_empty());
    }

    #[test]
    fn osc7777_malformed_base64_ignored() {
        let mut p = OscParser::new();
        assert!(p.feed(b"\x1b]7777;open_url;!!!\x07").is_empty());
    }

    #[test]
    fn osc7777_split_across_chunks() {
        let mut p = OscParser::new();
        let full = osc7777_open_url("https://example.com");
        let (a, b) = full.split_at(8);
        assert!(p.feed(a).is_empty());
        let events = p.feed(b);
        assert_eq!(events.len(), 1);
        match &events[0] {
            OscEvent::OpenUrl(url) => assert_eq!(url, "https://example.com"),
            other => panic!("unexpected event: {:?}", other),
        }
    }

    // ---- OSC 7777 edit_request ----

    /// Build a BEL-terminated OSC 7777 `edit_request` sequence from raw
    /// field values (id, filename as UTF-8; contents as arbitrary bytes).
    fn osc7777_edit_request(id: &str, filename: &str, contents: &[u8]) -> Vec<u8> {
        let engine = base64::engine::general_purpose::STANDARD;
        let id_b64 = engine.encode(id.as_bytes());
        let filename_b64 = engine.encode(filename.as_bytes());
        let contents_b64 = engine.encode(contents);
        let mut v = Vec::new();
        v.extend_from_slice(b"\x1b]7777;edit_request;");
        v.extend_from_slice(id_b64.as_bytes());
        v.push(b';');
        v.extend_from_slice(filename_b64.as_bytes());
        v.push(b';');
        v.extend_from_slice(contents_b64.as_bytes());
        v.push(0x07);
        v
    }

    #[test]
    fn parses_osc7777_edit_request() {
        let mut p = OscParser::new();
        let events = p.feed(&osc7777_edit_request(
            "req-1",
            "/tmp/foo.txt",
            b"hello world",
        ));
        assert_eq!(events.len(), 1);
        match &events[0] {
            OscEvent::EditRequest {
                id,
                filename,
                contents,
            } => {
                assert_eq!(id, "req-1");
                assert_eq!(filename, "/tmp/foo.txt");
                assert_eq!(contents, b"hello world");
            }
            other => panic!("unexpected event: {:?}", other),
        }
    }

    #[test]
    fn parses_osc7777_edit_request_utf8_filename() {
        let mut p = OscParser::new();
        let events = p.feed(&osc7777_edit_request(
            "abc",
            "/tmp/café.txt",
            "🌍".as_bytes(),
        ));
        assert_eq!(events.len(), 1);
        match &events[0] {
            OscEvent::EditRequest {
                id,
                filename,
                contents,
            } => {
                assert_eq!(id, "abc");
                assert_eq!(filename, "/tmp/café.txt");
                assert_eq!(std::str::from_utf8(contents).unwrap(), "🌍");
            }
            other => panic!("unexpected event: {:?}", other),
        }
    }

    #[test]
    fn parses_osc7777_edit_request_empty_contents() {
        // An empty file: the third base64 field is the empty string.
        let mut p = OscParser::new();
        let events = p.feed(&osc7777_edit_request("id-0", "/tmp/empty.txt", b""));
        assert_eq!(events.len(), 1);
        match &events[0] {
            OscEvent::EditRequest {
                id,
                filename,
                contents,
            } => {
                assert_eq!(id, "id-0");
                assert_eq!(filename, "/tmp/empty.txt");
                assert!(contents.is_empty());
            }
            other => panic!("unexpected event: {:?}", other),
        }
    }

    #[test]
    fn osc7777_edit_request_invalid_base64_id_ignored() {
        let mut p = OscParser::new();
        let mut buf = b"\x1b]7777;edit_request;!!!;".to_vec();
        buf.extend_from_slice(b64("/tmp/foo.txt").as_bytes());
        buf.push(b';');
        buf.extend_from_slice(b64("hello").as_bytes());
        buf.push(0x07);
        assert!(p.feed(&buf).is_empty());
    }

    #[test]
    fn osc7777_edit_request_invalid_base64_filename_ignored() {
        let mut p = OscParser::new();
        let mut buf = b"\x1b]7777;edit_request;".to_vec();
        buf.extend_from_slice(b64("req-1").as_bytes());
        buf.extend_from_slice(b";!!!;");
        buf.extend_from_slice(b64("hello").as_bytes());
        buf.push(0x07);
        assert!(p.feed(&buf).is_empty());
    }

    #[test]
    fn osc7777_edit_request_invalid_base64_contents_ignored() {
        let mut p = OscParser::new();
        let mut buf = b"\x1b]7777;edit_request;".to_vec();
        buf.extend_from_slice(b64("req-1").as_bytes());
        buf.push(b';');
        buf.extend_from_slice(b64("/tmp/foo.txt").as_bytes());
        buf.extend_from_slice(b";!!!");
        buf.push(0x07);
        assert!(p.feed(&buf).is_empty());
    }

    #[test]
    fn osc7777_edit_request_missing_semicolon_ignored() {
        // Only one semicolon after the subcommand → two fields, not three.
        let mut p = OscParser::new();
        let mut buf = b"\x1b]7777;edit_request;".to_vec();
        buf.extend_from_slice(b64("req-1").as_bytes());
        buf.push(b';');
        buf.extend_from_slice(b64("/tmp/foo.txt").as_bytes());
        buf.push(0x07);
        assert!(p.feed(&buf).is_empty());
    }

    #[test]
    fn osc7777_edit_request_split_across_chunks() {
        let mut p = OscParser::new();
        let full = osc7777_edit_request("req-1", "/tmp/foo.txt", b"hello world");
        let mid = full.len() / 2;
        assert!(p.feed(&full[..mid]).is_empty());
        let events = p.feed(&full[mid..]);
        assert_eq!(events.len(), 1);
        match &events[0] {
            OscEvent::EditRequest {
                id,
                filename,
                contents,
            } => {
                assert_eq!(id, "req-1");
                assert_eq!(filename, "/tmp/foo.txt");
                assert_eq!(contents, b"hello world");
            }
            other => panic!("unexpected event: {:?}", other),
        }
    }

    // ---- Mixed ----

    #[test]
    fn mixed_sequence_types_in_one_chunk() {
        let mut p = OscParser::new();
        let mut buf = bel_osc7("host", "/tmp");
        buf.extend(osc52_bel("c", &b64("copy-me")));
        buf.extend(osc7777_open_url("https://example.com"));
        let events = p.feed(&buf);
        assert_eq!(events.len(), 3);
        assert!(matches!(&events[0], OscEvent::Cwd(p) if p == "/tmp"));
        assert!(matches!(&events[1], OscEvent::ClipboardWrite(d) if d == b"copy-me"));
        assert!(matches!(&events[2], OscEvent::OpenUrl(u) if u == "https://example.com"));
    }
}

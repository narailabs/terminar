//! Benchmarks for the terminar server.
//!
//! Run with: cargo bench
//!
//! These benchmarks measure the performance of core operations:
//! - Message serialization/deserialization
//! - Session creation overhead
//! - History buffer operations (append, replay)
//! - Compression/decompression throughput

use criterion::{BenchmarkId, Criterion, black_box, criterion_group, criterion_main};
use std::collections::HashMap;

use terminar_server::history::{CircularBuffer, compress_history, decompress_history};
use terminar_server::messages::{ClientMessage, ServerMessage, SessionInfo};

// ---------------------------------------------------------------------------
// Message serialization / deserialization benchmarks
// ---------------------------------------------------------------------------

fn bench_serialize_client_messages(c: &mut Criterion) {
    let mut group = c.benchmark_group("serialize_client_message");

    let list_msg = ClientMessage::ListSessions;
    group.bench_function("ListSessions", |b| {
        b.iter(|| serde_json::to_string(black_box(&list_msg)).unwrap())
    });

    let input_msg = ClientMessage::Input {
        session_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
        data: "ls -la\n".to_string(),
    };
    group.bench_function("Input_small", |b| {
        b.iter(|| serde_json::to_string(black_box(&input_msg)).unwrap())
    });

    let large_data = "x".repeat(4096);
    let large_input_msg = ClientMessage::Input {
        session_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
        data: large_data,
    };
    group.bench_function("Input_4kb", |b| {
        b.iter(|| serde_json::to_string(black_box(&large_input_msg)).unwrap())
    });

    let mut env = HashMap::new();
    env.insert("PATH".to_string(), "/usr/bin:/bin".to_string());
    env.insert("HOME".to_string(), "/home/user".to_string());
    env.insert("TERM".to_string(), "xterm-256color".to_string());
    let create_msg = ClientMessage::CreateSession {
        cwd: "/home/user/projects".to_string(),
        shell: "/bin/bash".to_string(),
        env,
        cols: 120,
        rows: 40,
    };
    group.bench_function("CreateSession", |b| {
        b.iter(|| serde_json::to_string(black_box(&create_msg)).unwrap())
    });

    group.finish();
}

fn bench_deserialize_client_messages(c: &mut Criterion) {
    let mut group = c.benchmark_group("deserialize_client_message");

    let list_json = r#"{"type":"list_sessions"}"#;
    group.bench_function("ListSessions", |b| {
        b.iter(|| serde_json::from_str::<ClientMessage>(black_box(list_json)).unwrap())
    });

    let input_json =
        r#"{"type":"input","session_id":"550e8400-e29b-41d4-a716-446655440000","data":"ls -la\n"}"#;
    group.bench_function("Input_small", |b| {
        b.iter(|| serde_json::from_str::<ClientMessage>(black_box(input_json)).unwrap())
    });

    let create_json = r#"{"type":"create_session","cwd":"/home/user","shell":"/bin/bash","env":{"PATH":"/usr/bin"},"cols":120,"rows":40}"#;
    group.bench_function("CreateSession", |b| {
        b.iter(|| serde_json::from_str::<ClientMessage>(black_box(create_json)).unwrap())
    });

    group.finish();
}

fn bench_serialize_server_messages(c: &mut Criterion) {
    let mut group = c.benchmark_group("serialize_server_message");

    let output_msg = ServerMessage::Output {
        session_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
        data: "drwxr-xr-x  5 user user 4096 Jan 28 10:00 .\n".to_string(),
    };
    group.bench_function("Output_small", |b| {
        b.iter(|| serde_json::to_string(black_box(&output_msg)).unwrap())
    });

    let sessions: Vec<SessionInfo> = (0..10)
        .map(|i| SessionInfo {
            id: format!("session-{}", i),
            name: format!("Terminal {}", i),
            shell: "/bin/bash".to_string(),
            cwd: "/home/user".to_string(),
            started_at: "2025-01-28T10:00:00Z".to_string(),
        })
        .collect();
    let session_list_msg = ServerMessage::SessionList { sessions };
    group.bench_function("SessionList_10", |b| {
        b.iter(|| serde_json::to_string(black_box(&session_list_msg)).unwrap())
    });

    let error_msg = ServerMessage::Error {
        message: "Session not found".to_string(),
    };
    group.bench_function("Error", |b| {
        b.iter(|| serde_json::to_string(black_box(&error_msg)).unwrap())
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// History buffer benchmarks
// ---------------------------------------------------------------------------

fn bench_history_buffer_push(c: &mut Criterion) {
    let mut group = c.benchmark_group("history_buffer_push");

    // Push small chunks into a large buffer
    group.bench_function("small_chunk_100bytes", |b| {
        let mut buf = CircularBuffer::new(1024 * 1024); // 1MB
        let chunk = vec![b'A'; 100];
        b.iter(|| {
            buf.push(black_box(&chunk));
        })
    });

    // Push medium chunks
    group.bench_function("medium_chunk_4kb", |b| {
        let mut buf = CircularBuffer::new(1024 * 1024);
        let chunk = vec![b'B'; 4096];
        b.iter(|| {
            buf.push(black_box(&chunk));
        })
    });

    // Push large chunks (simulating large output)
    group.bench_function("large_chunk_64kb", |b| {
        let mut buf = CircularBuffer::new(1024 * 1024);
        let chunk = vec![b'C'; 65536];
        b.iter(|| {
            buf.push(black_box(&chunk));
        })
    });

    // Push with wrapping (buffer is full)
    group.bench_function("push_with_wrap_4kb", |b| {
        let mut buf = CircularBuffer::new(16384); // 16KB
        // Pre-fill to force wrapping
        buf.push(&vec![b'X'; 16384]);
        let chunk = vec![b'D'; 4096];
        b.iter(|| {
            buf.push(black_box(&chunk));
        })
    });

    group.finish();
}

fn bench_history_buffer_replay(c: &mut Criterion) {
    let mut group = c.benchmark_group("history_buffer_replay");

    for size in [1024, 16384, 262144, 1048576].iter() {
        let mut buf = CircularBuffer::new(*size);
        buf.push(&vec![b'R'; *size]); // fill completely

        group.bench_with_input(BenchmarkId::new("to_vec", size), size, |b, _| {
            b.iter(|| {
                black_box(buf.to_vec());
            })
        });
    }

    group.finish();
}

fn bench_history_buffer_creation(c: &mut Criterion) {
    let mut group = c.benchmark_group("history_buffer_creation");

    group.bench_function("default_capacity_10mb", |b| {
        b.iter(|| {
            black_box(CircularBuffer::with_default_capacity());
        })
    });

    group.bench_function("small_capacity_64kb", |b| {
        b.iter(|| {
            black_box(CircularBuffer::new(65536));
        })
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Compression / decompression benchmarks
// ---------------------------------------------------------------------------

fn bench_compression(c: &mut Criterion) {
    let mut group = c.benchmark_group("compression");

    // Typical terminal output (repetitive, compresses well)
    let terminal_output =
        "user@host:~$ ls -la\ndrwxr-xr-x  5 user user 4096 Jan 28 10:00 .\n".repeat(1000);
    let terminal_bytes = terminal_output.as_bytes();

    group.bench_function("compress_terminal_output_50kb", |b| {
        b.iter(|| {
            black_box(compress_history(black_box(terminal_bytes)).unwrap());
        })
    });

    let compressed_terminal = compress_history(terminal_bytes).unwrap();
    group.bench_function("decompress_terminal_output_50kb", |b| {
        b.iter(|| {
            black_box(decompress_history(black_box(&compressed_terminal)).unwrap());
        })
    });

    // Random-ish data (binary output, compresses poorly)
    let random_data: Vec<u8> = (0..50_000).map(|i| (i * 7 + 13) as u8).collect();
    group.bench_function("compress_binary_data_50kb", |b| {
        b.iter(|| {
            black_box(compress_history(black_box(&random_data)).unwrap());
        })
    });

    let compressed_random = compress_history(&random_data).unwrap();
    group.bench_function("decompress_binary_data_50kb", |b| {
        b.iter(|| {
            black_box(decompress_history(black_box(&compressed_random)).unwrap());
        })
    });

    // Large data (1MB)
    let large_data = "ABCDEFGHIJKLMNOPQRSTUVWXYZ\n".repeat(40_000);
    let large_bytes = large_data.as_bytes();
    group.bench_function("compress_1mb", |b| {
        b.iter(|| {
            black_box(compress_history(black_box(large_bytes)).unwrap());
        })
    });

    let compressed_large = compress_history(large_bytes).unwrap();
    group.bench_function("decompress_1mb", |b| {
        b.iter(|| {
            black_box(decompress_history(black_box(&compressed_large)).unwrap());
        })
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Criterion groups
// ---------------------------------------------------------------------------

criterion_group!(
    serialization,
    bench_serialize_client_messages,
    bench_deserialize_client_messages,
    bench_serialize_server_messages,
);

criterion_group!(
    history,
    bench_history_buffer_push,
    bench_history_buffer_replay,
    bench_history_buffer_creation,
);

criterion_group!(compression, bench_compression,);

criterion_main!(serialization, history, compression);

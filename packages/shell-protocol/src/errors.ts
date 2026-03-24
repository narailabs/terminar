export type ErrorCode =
  | 'AUTH_FAILED'
  | 'SESSION_NOT_FOUND'
  | 'PTY_ERROR'
  | 'WEBSOCKET_ERROR'
  | 'PROTOCOL_ERROR'
  | 'RATE_LIMIT_EXCEEDED'
  | 'INVALID_INPUT'
  | 'INTERNAL_ERROR'
  | 'PARSE_ERROR'
  | 'VALIDATION_ERROR';

export class ShellProtocolError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
  ) {
    super(message);
    this.name = 'ShellProtocolError';
  }
}

export class AuthError extends ShellProtocolError {
  constructor(message: string) {
    super(message, 'AUTH_FAILED');
    this.name = 'AuthError';
  }
}

export class SessionError extends ShellProtocolError {
  constructor(message: string) {
    super(message, 'SESSION_NOT_FOUND');
    this.name = 'SessionError';
  }
}

export class ParseError extends ShellProtocolError {
  constructor(message: string) {
    super(message, 'PARSE_ERROR');
    this.name = 'ParseError';
  }
}

export class ValidationError extends ShellProtocolError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class PtyError extends ShellProtocolError {
  constructor(message: string) {
    super(message, 'PTY_ERROR');
    this.name = 'PtyError';
  }
}

export class RateLimitError extends ShellProtocolError {
  constructor(message: string) {
    super(message, 'RATE_LIMIT_EXCEEDED');
    this.name = 'RateLimitError';
  }
}

export class InvalidInputError extends ShellProtocolError {
  constructor(message: string) {
    super(message, 'INVALID_INPUT');
    this.name = 'InvalidInputError';
  }
}

export class InternalError extends ShellProtocolError {
  constructor(message: string) {
    super(message, 'INTERNAL_ERROR');
    this.name = 'InternalError';
  }
}

class WebSocketError extends ShellProtocolError {
  constructor(message: string) {
    super(message, 'WEBSOCKET_ERROR');
    this.name = 'WebSocketError';
  }
}

class ProtocolError extends ShellProtocolError {
  constructor(message: string) {
    super(message, 'PROTOCOL_ERROR');
    this.name = 'ProtocolError';
  }
}

const ERROR_CODE_TO_CLASS: Record<ErrorCode, new (message: string) => ShellProtocolError> = {
  AUTH_FAILED: AuthError,
  SESSION_NOT_FOUND: SessionError,
  PTY_ERROR: PtyError,
  WEBSOCKET_ERROR: WebSocketError,
  PROTOCOL_ERROR: ProtocolError,
  RATE_LIMIT_EXCEEDED: RateLimitError,
  INVALID_INPUT: InvalidInputError,
  INTERNAL_ERROR: InternalError,
  PARSE_ERROR: ParseError,
  VALIDATION_ERROR: ValidationError,
};

function isErrorCode(code: string): code is ErrorCode {
  return code in ERROR_CODE_TO_CLASS;
}

/**
 * Create a typed error from a server error code and message.
 * Falls back to InternalError if the code is unknown or missing.
 */
export function createErrorFromCode(message: string, errorCode?: string): ShellProtocolError {
  if (errorCode && isErrorCode(errorCode)) {
    return new ERROR_CODE_TO_CLASS[errorCode](message);
  }
  return new InternalError(message);
}

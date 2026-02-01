export type ErrorCode =
  | 'AUTH_FAILED'
  | 'SESSION_NOT_FOUND'
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

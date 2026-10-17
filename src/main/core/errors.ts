export class ToolkitError extends Error {
  code: string;
  detail?: string;
  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'ToolkitError';
    this.code = code;
    this.detail = detail;
  }
}

export function toTkError(err: unknown): { code: string; message: string; detail?: string } {
  if (err instanceof ToolkitError) {
    return { code: err.code, message: err.message, detail: err.detail };
  }
  if (err instanceof Error) {
    return { code: 'INTERNAL', message: err.message, detail: err.stack };
  }
  return { code: 'INTERNAL', message: String(err) };
}

export function assert(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new ToolkitError(code, message);
}

export interface ParseRequest {
  text: string;
  context: string;
}

export interface Provider {
  id: string;
  model: string;
  /** 返回模型的原始 JSON 文本；校验由调用方完成。 */
  parse(req: ParseRequest): Promise<string>;
}

export class ProviderError extends Error {
  constructor(message: string, public retryable = true) {
    super(message);
  }
}

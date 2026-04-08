export class NivenError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NivenError";
  }
}

export class NotImplementedYetError extends NivenError {
  constructor(feature: string) {
    super(`${feature} is not implemented yet.`);
    this.name = "NotImplementedYetError";
  }
}

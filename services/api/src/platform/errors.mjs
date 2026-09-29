export function fail(statusCode, code) {
  throw Object.assign(new Error(code), { statusCode });
}
export const string = (maxLength, minLength = 1) => ({
  type: "string",
  minLength,
  maxLength,
});
export const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

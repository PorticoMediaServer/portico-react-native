import {
  productMessage,
  resolveProductProblem,
  type ProductMessageId,
  type ProductMessageVariables,
} from '@porticomediaserver/client-core';

const unresolvedToken = /\{[A-Za-z][A-Za-z0-9]*\}/;
const genericProductFallback = "Portico couldn't complete this request.";

export function safeProductCopy(value: string | undefined, fallback = genericProductFallback): string {
  const normalized = value?.trim();
  return normalized && !unresolvedToken.test(normalized) ? normalized : fallback;
}

export function productText(
  id: ProductMessageId,
  variables: ProductMessageVariables = {},
): string {
  const message = productMessage(id, variables);
  return safeProductCopy(message.text ?? message.title ?? message.body);
}

export function productTitle(
  id: ProductMessageId,
  variables: ProductMessageVariables = {},
): string {
  const message = productMessage(id, variables);
  return safeProductCopy(message.title ?? message.text ?? message.body);
}

export function productBody(
  id: ProductMessageId,
  variables: ProductMessageVariables = {},
): string {
  const message = productMessage(id, variables);
  return safeProductCopy(message.body ?? message.text ?? message.title);
}

export function productErrorBody(
  error: unknown,
  fallbackId: ProductMessageId,
  variables: ProductMessageVariables = {},
): string {
  if (isProductProblem(error)) {
    const presentation = resolveProductProblem(error, variables);
    return safeProductCopy(presentation.body ?? presentation.text ?? presentation.title);
  }
  return productBody(fallbackId, variables);
}

function isProductProblem(error: unknown): error is {
  code?: string;
  messageId?: string;
  status?: number;
  details?: Readonly<Record<string, unknown>>;
} {
  return (
    typeof error === 'object' &&
    error !== null &&
    ('code' in error || 'messageId' in error || 'status' in error)
  );
}

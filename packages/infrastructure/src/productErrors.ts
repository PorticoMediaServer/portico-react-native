import {
  productMessage,
  resolveProductProblem,
  type ProductMessageId,
  type ProductMessagePresentation,
  type ProductMessageVariables,
} from '@porticomediaserver/client-core';

/** A reviewed catalog message carried through validation or local boundaries. */
export class ProductMessageError extends Error {
  readonly messageId: ProductMessageId;
  readonly variables: ProductMessageVariables;

  constructor(
    messageId: ProductMessageId,
    variables: ProductMessageVariables = {},
  ) {
    super(productMessageText(messageId, variables));
    this.name = 'ProductMessageError';
    this.messageId = messageId;
    this.variables = variables;
  }
}
export function productMessageText(
  id: ProductMessageId,
  variables: ProductMessageVariables = {},
): string {
  return productPresentationText(
    productMessage(id, {
      serverName: 'this server',
      profileName: 'This profile',
      ...variables,
    }),
  );
}

/**
 * Resolves failures to a complete catalog presentation. Unknown exception
 * text is never surfaced; the caller's contextual catalog ID wins instead.
 */
export function productErrorPresentation(
  value: unknown,
  fallbackId: ProductMessageId,
  variables: ProductMessageVariables = {},
): ProductMessagePresentation {
  const contextualVariables: ProductMessageVariables = {
    serverName: 'this server',
    profileName: 'This profile',
    ...variables,
  };
  if (value instanceof ProductMessageError)
    return productMessage(value.messageId, {
      ...contextualVariables,
      ...definedProductVariables(value.variables),
    });
  const problem = structuredProblem(value);
  if (problem) {
    const resolved = resolveProductProblem(problem, contextualVariables);
    if (resolved.id !== 'problem.request-failed') return resolved;
  }
  return productMessage(fallbackId, contextualVariables);
}

function definedProductVariables(
  variables: ProductMessageVariables,
): ProductMessageVariables {
  return Object.fromEntries(
    Object.entries(variables).filter(([, value]) => value !== undefined),
  );
}

function structuredProblem(value: unknown): {
  code?: string;
  messageId?: string;
  status?: number;
  details?: Readonly<Record<string, unknown>>;
} | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  return {
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    messageId: typeof candidate.messageId === 'string' ? candidate.messageId : undefined,
    status: typeof candidate.status === 'number' ? candidate.status : undefined,
    details: candidate.details && typeof candidate.details === 'object' && !Array.isArray(candidate.details)
      ? candidate.details as Readonly<Record<string, unknown>>
      : undefined,
  };
}

export function productErrorMessageId(
  value: unknown,
  fallbackId: ProductMessageId,
  variables: ProductMessageVariables = {},
): string {
  const message = productErrorPresentation(value, fallbackId, variables);
  return productPresentationText(message);
}

function productPresentationText(
  presentation: ProductMessagePresentation,
): string {
  const text = presentation.body ?? presentation.title ?? presentation.text;
  return text && !/\{[A-Za-z][A-Za-z0-9]*\}/.test(text)
    ? text
    : "Portico couldn't complete this request.";
}

export const PROPOSE_NAME = 'propose_changes';

export const PROPOSE_DESCRIPTION =
  'Propose edits to the CURRENT OpenAPI specification as JSON Patch (RFC 6902) operations: add, replace or remove. The reviewer must accept them before they apply. Paths are JSON Pointers; escape "/" in keys as "~1".';

export const PROPOSE_SCHEMA = {
  type: 'object' as const,
  properties: {
    summary: { type: 'string', description: 'One line describing the change' },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { op: { type: 'string', enum: ['add', 'replace', 'remove'] }, path: { type: 'string' }, value: {} },
        required: ['op', 'path'],
      },
    },
  },
  required: ['summary', 'operations'],
};

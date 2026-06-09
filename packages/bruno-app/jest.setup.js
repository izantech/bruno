const { TextDecoder: NodeTextDecoder, TextEncoder: NodeTextEncoder } = require('util');
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = NodeTextDecoder;
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = NodeTextEncoder;

jest.mock('nanoid', () => {
  return {
    nanoid: () => {}
  };
});

jest.mock('strip-json-comments', () => {
  return {
    stripJsonComments: (str) => str
  };
});

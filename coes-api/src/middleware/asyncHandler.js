'use strict';

// Envuelve handlers async para que los errores caigan en el middleware global
module.exports = function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};

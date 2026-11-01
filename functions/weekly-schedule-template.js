'use strict';

function resolveTemplate(requested, existing) {
  const template = requested == null ? (existing || 'default') : String(requested);
  return ['default', 'starlight'].includes(template) ? template : null;
}

function mayUseTemplate(template, { isAdmin = false } = {}) {
  return template === 'default' || (template === 'starlight' && isAdmin);
}

module.exports = { resolveTemplate, mayUseTemplate };

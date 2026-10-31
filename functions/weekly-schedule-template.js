'use strict';

function resolveTemplate(requested, existing) {
  const template = requested == null ? (existing || 'default') : String(requested);
  return ['default', 'starlight'].includes(template) ? template : null;
}

function mayUseTemplate(template, { isAdmin = false, expiresAt = 0, now = Date.now() } = {}) {
  return template === 'default' || (template === 'starlight' && (isAdmin || Number(expiresAt) > now));
}

module.exports = { resolveTemplate, mayUseTemplate };

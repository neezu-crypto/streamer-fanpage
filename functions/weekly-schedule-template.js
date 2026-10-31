'use strict';

function resolveTemplate(requested, existing) {
  const template = requested == null ? (existing || 'default') : String(requested);
  return ['default', 'starlight'].includes(template) ? template : null;
}

function mayUseTemplate(template, { isAdmin = false, isVerifiedStreamer = false } = {}) {
  return template === 'default' || (template === 'starlight' && (isAdmin || isVerifiedStreamer));
}

module.exports = { resolveTemplate, mayUseTemplate };

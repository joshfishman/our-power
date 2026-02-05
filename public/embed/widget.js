(function () {
  'use strict';

  var SITE_URL = (function () {
    var scripts = document.querySelectorAll('script[src*="widget.js"]');
    if (scripts.length > 0) {
      var src = scripts[scripts.length - 1].src;
      return new URL(src).origin;
    }
    return 'https://ourpower.com';
  })();

  var STYLES = [
    ':host { display: block; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
    '.op-widget { border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background: #fff; max-width: 400px; }',
    '.op-widget[data-theme="dark"] { background: #1f2937; border-color: #374151; color: #f9fafb; }',
    '.op-widget-header { padding: 16px 20px 12px; }',
    '.op-widget-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: #fff; padding: 3px 10px; border-radius: 20px; margin-bottom: 8px; }',
    '.op-widget-title { font-size: 18px; font-weight: 700; margin: 0 0 4px; line-height: 1.3; }',
    '.op-widget-org { font-size: 13px; color: #6b7280; margin: 0 0 8px; }',
    '[data-theme="dark"] .op-widget-org { color: #9ca3af; }',
    '.op-widget-desc { font-size: 14px; color: #4b5563; line-height: 1.5; margin: 0 0 12px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }',
    '[data-theme="dark"] .op-widget-desc { color: #d1d5db; }',
    '.op-widget-stats { display: flex; gap: 16px; font-size: 13px; color: #6b7280; margin-bottom: 12px; }',
    '[data-theme="dark"] .op-widget-stats { color: #9ca3af; }',
    '.op-widget-stats span { display: flex; align-items: center; gap: 4px; }',
    '.op-widget-cta { display: block; text-align: center; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 20px; font-size: 15px; font-weight: 600; border-radius: 0 0 11px 11px; transition: background 0.15s; }',
    '.op-widget-cta:hover { background: #6d28d9; }',
    '.op-widget-action-meta { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; color: #6b7280; margin-bottom: 8px; }',
    '[data-theme="dark"] .op-widget-action-meta { color: #9ca3af; }',
    '.op-widget-action-meta span { display: flex; align-items: center; gap: 3px; }',
    '.op-widget-type-icon { font-size: 16px; }',
    '.op-widget-loading { padding: 32px; text-align: center; color: #9ca3af; font-size: 14px; }',
    '.op-widget-error { padding: 20px; text-align: center; color: #ef4444; font-size: 14px; }',
  ].join('\n');

  var ACTION_TYPE_ICONS = { EVENT: '📍', PHONE: '📞', EMAIL: '✉️', CANVASS: '🚶' };
  var ACTION_TYPE_LABELS = { EVENT: 'Event', PHONE: 'Phone Bank', EMAIL: 'Email Campaign', CANVASS: 'Canvassing' };

  function formatDate(dateStr) {
    var d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function renderCampaignWidget(container, data, theme) {
    var campaign = data;
    var causeBg = (campaign.cause && campaign.cause.color) || '#7c3aed';
    var causeLabel = campaign.cause ? ((campaign.cause.icon || '') + ' ' + campaign.cause.name) : '';
    var orgName = campaign.org ? campaign.org.name : '';
    var memberCount = campaign._count ? campaign._count.members : 0;
    var actionCount = campaign._count ? campaign._count.actions : 0;

    container.innerHTML = [
      '<div class="op-widget"' + (theme === 'dark' ? ' data-theme="dark"' : '') + '>',
      '  <div class="op-widget-header">',
      causeLabel ? '    <span class="op-widget-badge" style="background:' + causeBg + '">' + causeLabel + '</span>' : '',
      '    <h3 class="op-widget-title">' + escapeHtml(campaign.name) + '</h3>',
      orgName ? '    <p class="op-widget-org">by ' + escapeHtml(orgName) + '</p>' : '',
      '    <p class="op-widget-desc">' + escapeHtml(campaign.description || '') + '</p>',
      '    <div class="op-widget-stats">',
      '      <span>👥 ' + memberCount + ' members</span>',
      '      <span>📋 ' + actionCount + ' actions</span>',
      '    </div>',
      '  </div>',
      '  <a class="op-widget-cta" href="' + SITE_URL + '/c/' + campaign.id + '" target="_blank" rel="noopener">Join Campaign on Our Power →</a>',
      '</div>',
    ].join('\n');
  }

  function renderActionWidget(container, data, theme) {
    var action = data;
    var icon = ACTION_TYPE_ICONS[action.type] || '📋';
    var label = ACTION_TYPE_LABELS[action.type] || action.type;
    var campaignId = action.campaign ? action.campaign.id : '';
    var campaignName = action.campaign ? action.campaign.name : '';
    var participants = action._count ? action._count.participants : 0;

    container.innerHTML = [
      '<div class="op-widget"' + (theme === 'dark' ? ' data-theme="dark"' : '') + '>',
      '  <div class="op-widget-header">',
      '    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">',
      '      <span class="op-widget-type-icon">' + icon + '</span>',
      '      <span style="font-size:12px;font-weight:600;text-transform:uppercase;color:#6b7280">' + label + '</span>',
      '    </div>',
      '    <h3 class="op-widget-title">' + escapeHtml(action.title) + '</h3>',
      campaignName ? '    <p class="op-widget-org">Campaign: ' + escapeHtml(campaignName) + '</p>' : '',
      '    <div class="op-widget-action-meta">',
      action.dueDate ? '      <span>📅 ' + formatDate(action.dueDate) + '</span>' : '',
      action.location ? '      <span>📍 ' + escapeHtml(action.location) + '</span>' : '',
      '      <span>👥 ' + participants + ' participants</span>',
      '    </div>',
      action.description ? '    <p class="op-widget-desc">' + escapeHtml(action.description) + '</p>' : '',
      '  </div>',
      campaignId
        ? '  <a class="op-widget-cta" href="' + SITE_URL + '/c/' + campaignId + '" target="_blank" rel="noopener">Take Action on Our Power →</a>'
        : '',
      '</div>',
    ].join('\n');
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function initWidgets() {
    var widgets = document.querySelectorAll('[data-op-widget]');

    for (var i = 0; i < widgets.length; i++) {
      (function (el) {
        // Skip already-initialized widgets
        if (el.getAttribute('data-op-initialized')) return;
        el.setAttribute('data-op-initialized', 'true');

        var widgetType = el.getAttribute('data-op-widget');
        var theme = el.getAttribute('data-theme') || '';

        // Create Shadow DOM
        var shadow = el.attachShadow({ mode: 'open' });
        var style = document.createElement('style');
        style.textContent = STYLES;
        shadow.appendChild(style);

        var wrapper = document.createElement('div');
        wrapper.innerHTML = '<div class="op-widget-loading">Loading...</div>';
        shadow.appendChild(wrapper);

        var apiUrl;
        if (widgetType === 'campaign') {
          var campaignId = el.getAttribute('data-campaign-id');
          if (!campaignId) {
            wrapper.innerHTML = '<div class="op-widget-error">Missing data-campaign-id attribute</div>';
            return;
          }
          apiUrl = SITE_URL + '/api/campaigns/' + campaignId;
        } else if (widgetType === 'action') {
          var actionId = el.getAttribute('data-action-id');
          if (!actionId) {
            wrapper.innerHTML = '<div class="op-widget-error">Missing data-action-id attribute</div>';
            return;
          }
          // Fetch from actions endpoint, then filter by id
          apiUrl = SITE_URL + '/api/campaigns';
          // For action widgets, we need a dedicated endpoint or use the actions list
          // Since there's no /api/actions/:id, we fetch via the actions list
          fetch(SITE_URL + '/api/actions?limit=100')
            .then(function (res) { return res.json(); })
            .then(function (actions) {
              var action = null;
              if (Array.isArray(actions)) {
                for (var j = 0; j < actions.length; j++) {
                  if (actions[j].id === actionId) {
                    action = actions[j];
                    break;
                  }
                }
              }
              if (!action) {
                wrapper.innerHTML = '<div class="op-widget-error">Action not found</div>';
                return;
              }
              renderActionWidget(wrapper, action, theme);
            })
            .catch(function () {
              wrapper.innerHTML = '<div class="op-widget-error">Failed to load action</div>';
            });
          return;
        } else {
          wrapper.innerHTML = '<div class="op-widget-error">Unknown widget type: ' + escapeHtml(widgetType || '') + '</div>';
          return;
        }

        fetch(apiUrl)
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (widgetType === 'campaign') {
              renderCampaignWidget(wrapper, data, theme);
            }
          })
          .catch(function () {
            wrapper.innerHTML = '<div class="op-widget-error">Failed to load widget</div>';
          });
      })(widgets[i]);
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWidgets);
  } else {
    initWidgets();
  }
})();

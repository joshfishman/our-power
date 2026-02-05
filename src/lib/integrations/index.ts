// Scale to Win (Phone Banking)
export {
  generateDialerUrl,
  generateUserDialerLink,
  formatCallScript,
  trackSessionStart,
  estimateCalls,
  type ScaleToWinConfig,
  type ScaleToWinAction,
} from './scaleToWin';

// Ecanvasser (Canvassing)
export {
  getCampaigns as getEcanvasserCampaigns,
  getCampaign as getEcanvasserCampaign,
  createCampaign as createEcanvasserCampaign,
  getContacts as getEcanvasserContacts,
  addContacts as addEcanvasserContacts,
  getCanvassResults,
  calculateCanvassStats,
  generateCanvassDeepLink,
  syncActionToEcanvasser,
  getActionCanvassStats,
  type EcanvasserCampaign,
  type EcanvasserContact,
  type CanvassResult,
  type CanvassStats,
} from './ecanvasser';

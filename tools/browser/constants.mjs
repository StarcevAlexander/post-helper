export const TASK_NAME = 'PostHelperBridgeWatch';
export const SCRIPT_PATH = ['tools', 'browser', 'bridge.mjs'];
export const HIDDEN_TASK_PATH = ['tools', 'hidden-task.ps1'];
export const ENV_PATH = ['server', '.env'];
export const LOG_FILE = 'bridge.log';
export const STATE_FILE = 'state.json';

export const ACTIONS = ['check', 'fix', 'run', 'install', 'uninstall', 'status'];
export const DEFAULT_PROFILE = 'Default';

export const EXTENSION_ID = 'fcoeoabgfenejglbffodgkkbkcdhcgfn';
export const HOST_NAME = 'com.anthropic.claude_code_browser_extension';
export const HOST_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
export const CHROME_APP_PATH_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe';
export const CHROME_RELATIVE = ['Google', 'Chrome', 'Application', 'chrome.exe'];
export const CHROME_PROCESS = 'chrome.exe';
export const LOCK_PROCESS = 'LogonUI.exe';

export const PROBE_TOOL = 'mcp__claude-in-chrome__tabs_context_mcp';
export const PROBE_PROMPT =
  'Call the tool mcp__claude-in-chrome__tabs_context_mcp exactly once. Reply with the single word FAIL followed by the error text only if the tool is missing or its answer says the browser or the extension is not connected, unavailable or timed out. Any other tool answer, including a message about a tab group, means success: reply with the single word OK.';
export const PROBE_TIMEOUT_MS = 90000;
export const DETAIL_LIMIT = 300;

export const CHROME_START_MS = 30000;
export const CHROME_CLOSE_MS = 20000;
export const TUNNEL_URL = 'https://api.anthropic.com/';
export const TUNNEL_TIMEOUT_MS = 25000;
export const NETWORK_ERROR_CODES = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT'];
export const TUNNEL_ADAPTER_PREFIX = 'happ-';

export const TELEGRAM_API = 'https://api.telegram.org';
export const TELEGRAM_TIMEOUT_MS = 30000;
export const REPEAT_ALERT_HOURS = 12;
export const CHECK_EVERY_MINUTES = 60;
export const FIX_COMMAND = 'node tools/browser/bridge.mjs fix';

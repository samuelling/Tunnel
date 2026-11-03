// Paste your Cloudflare Worker URL here after deploying /worker (see README), e.g.
// export const WORKER_URL = 'https://tunnel-claude.yourname.workers.dev';
// It powers "Type anything" (Claude-designed objects) and is the portal's mailbox
// (debris drops go to WORKER_URL + '/drops', where World Builder collects them).
export const WORKER_URL = 'https://tunnel-claude.samuelling.workers.dev';

// Extra places to deliver debris drops directly, e.g. a World Builder server:
// 'https://worldbuilder.example.com/api/shred/drops' or 'http://localhost:3000/api/shred/drops'
export const DROP_URLS = [];

// Where the 🌀 teleport button sends players: World Builder's address (Matt's server).
// Players can change it in the teleport dialog; their choice is remembered in this browser.
export const WORLD_BUILDER_URL = 'http://localhost:3000';

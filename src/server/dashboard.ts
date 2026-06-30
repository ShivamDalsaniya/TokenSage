import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { sessionTracker } from "../analytics/session-tracker.js";
import { DEFAULT_CONFIG } from "../config/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = join(__dirname, "../public/tokensage-logo.webp");

const MODEL_DISPLAY_MAP: Record<string, string> = {
  "opus": "Claude Opus 4.6",
  "opus[1m]": "Claude Opus 4.6",
  "sonnet": "Claude Sonnet 4.6",
  "haiku": "Claude Haiku 4.5",
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
};

function readModelFromSettings(): string {
  try {
    const settingsPath = join(homedir(), ".claude", "settings.json");
    const raw = readFileSync(settingsPath, "utf-8");
    const data = JSON.parse(raw);
    if (typeof data.model === "string" && data.model) {
      const key = data.model.toLowerCase();
      return MODEL_DISPLAY_MAP[key] ?? data.model;
    }
  } catch { /* ignore */ }
  return process.env["ANTHROPIC_MODEL"] ?? process.env["AI_MODEL"] ?? "Claude Sonnet 4.6";
}

const MODEL_NAME = readModelFromSettings();
const AGENT_NAME = process.env["TOKENSAGE_AGENT"] ?? "Claude Code";

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function modelIconSvg(model: string): string {
  const m = model.toLowerCase();
  // Anthropic / Claude — 8 thick rounded bars radially arranged (matches official logo)
  if (m.includes("claude")) return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" style="flex-shrink:0"><g transform="translate(9,9)">${Array.from({length:8},(_,i)=>`<rect x="-1.1" y="-8.2" width="2.2" height="5.2" rx="1.1" fill="#e8784d" transform="rotate(${i*45})"/>`).join('')}</g></svg>`;
  // OpenAI / GPT / Codex / o-series — swirl circle
  if (m.includes("gpt")||m.includes("codex")||m.includes("o1")||m.includes("o3")||m.includes("o4")) return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" style="flex-shrink:0"><path d="M9 2.5a6.5 6.5 0 1 1 0 13A6.5 6.5 0 0 1 9 2.5z" stroke="#10b981" stroke-width="1.5"/><path d="M6 9c0-1.66 1.34-3 3-3s3 1.34 3 3-1.34 3-3 3" stroke="#10b981" stroke-width="1.5" stroke-linecap="round"/><circle cx="9" cy="9" r="1.2" fill="#10b981"/></svg>`;
  // Cursor
  if (m.includes("cursor")) return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" style="flex-shrink:0"><path d="M4 3l10 6-5.5 1.5L7 16 4 3z" stroke="#3b82f6" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  // Google / Gemini — diamond
  if (m.includes("gemini")||m.includes("google")) return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" style="flex-shrink:0"><path d="M9 2L14 9L9 16L4 9Z" stroke="#4285f4" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 2C9 2 11 5.5 11 9C11 12.5 9 16 9 16" stroke="#ea4335" stroke-width="1.2"/><path d="M9 2C9 2 7 5.5 7 9C7 12.5 9 16 9 16" stroke="#34a853" stroke-width="1.2"/></svg>`;
  // Meta / Llama — infinity
  if (m.includes("llama")||m.includes("meta")) return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" style="flex-shrink:0"><path d="M3 9c0-2 1.5-3.5 3-3.5S8.5 7 9 9s1.5 3.5 3 3.5 3-1.5 3-3.5-1.5-3.5-3-3.5S8.5 11 8 9 6.5 5.5 6 5.5 3 7 3 9z" stroke="#8b5cf6" stroke-width="1.5"/></svg>`;
  // Mistral — wave
  if (m.includes("mistral")) return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" style="flex-shrink:0"><rect x="3" y="4" width="4" height="4" rx="0.5" fill="#f59e0b"/><rect x="11" y="4" width="4" height="4" rx="0.5" fill="#f59e0b"/><rect x="7" y="8" width="4" height="4" rx="0.5" fill="#f59e0b" opacity="0.7"/><rect x="3" y="12" width="4" height="2" rx="0.5" fill="#f59e0b" opacity="0.5"/><rect x="11" y="12" width="4" height="2" rx="0.5" fill="#f59e0b" opacity="0.5"/></svg>`;
  // DeepSeek — eye
  if (m.includes("deepseek")) return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" style="flex-shrink:0"><path d="M2 9c2-4 12-4 14 0-2 4-12 4-14 0z" stroke="#06b6d4" stroke-width="1.5"/><circle cx="9" cy="9" r="2.5" stroke="#06b6d4" stroke-width="1.5"/><circle cx="9" cy="9" r="1" fill="#06b6d4"/></svg>`;
  // Default — generic sparkle
  return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" style="flex-shrink:0"><circle cx="9" cy="9" r="6" stroke="#6b7280" stroke-width="1.5"/><circle cx="9" cy="9" r="2" fill="#6b7280"/></svg>`;
}

const LOGO_B64 = "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";


function buildDashboardHtml(projectName: string): string {
const safeProjectName = escHtml(projectName);
const safeModel = escHtml(MODEL_NAME);
const safeAgent = escHtml(AGENT_NAME);
return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>TokenSage — ${safeProjectName}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{
  background:#0b0d11;color:#f9fafb;
  font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;
  height:100vh;overflow:hidden;
  display:grid;grid-template-columns:256px 1fr;
}
/* ─── SIDEBAR ─── */
.sb{background:#0d1117;border-right:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;overflow:hidden;}
.sb-logo-row{display:flex;align-items:center;gap:12px;padding:20px 20px 16px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;}
.sb-logo{width:52px;height:52px;border-radius:10px;overflow:hidden;flex-shrink:0;}
.sb-logo img{width:100%;height:100%;object-fit:cover;display:block;}
.sb-brand-name{font-size:22px;font-weight:700;letter-spacing:-0.3px;}
.sb-brand-token{color:#f9fafb;}
.sb-brand-sage{background:linear-gradient(135deg,#10b981,#3b82f6,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.sb-status{padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;}
.sb-status-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;color:#6b7280;margin-bottom:8px;}
.sb-status-row{display:flex;align-items:center;gap:8px;}
.mcp-dot{width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 8px rgba(16,185,129,0.8);flex-shrink:0;animation:glow 2.5s ease-in-out infinite;}
.mcp-dot.offline{background:#ef4444;box-shadow:0 0 8px rgba(239,68,68,0.8);}
@keyframes glow{0%,100%{opacity:1}50%{opacity:0.4}}
.mcp-txt{font-size:13px;font-weight:600;color:#10b981;}
.mcp-txt.offline{color:#ef4444;}
.sb-cards{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;}
.sb-card{background:rgba(17,24,39,0.6);backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:12px 14px;}
.sb-card-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;color:#6b7280;margin-bottom:4px;}
.sb-card-val{font-size:13px;font-weight:600;color:#f9fafb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:8px;}
.sb-tools-section{display:flex;flex-direction:column;overflow:hidden;flex:1;min-height:0;}
.sb-sect-hdr{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;color:#6b7280;padding:12px 20px 6px;flex-shrink:0;}
.sb-tools-list{flex:1;overflow-y:auto;padding:0 12px 8px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.05) transparent;}
.sb-tools-list::-webkit-scrollbar{width:2px;}
.tool-row{display:flex;align-items:center;gap:10px;padding:5px 8px;border-radius:6px;}
.tool-row:hover{background:rgba(255,255,255,0.03);}
.tool-icon-box{width:18px;height:18px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0;}
.tool-name{font-size:12px;color:#9ca3af;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.tool-active-dot{width:6px;height:6px;border-radius:50%;background:#10b981;box-shadow:0 0 5px rgba(16,185,129,0.8);flex-shrink:0;}
.sb-empty-txt{font-size:12px;color:#4b5563;padding:6px 8px;}
.sb-footer{border-top:1px solid rgba(255,255,255,0.06);flex-shrink:0;padding:12px 16px 10px;}
.sb-footer-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.sb-footer-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;color:#6b7280;}
.live-pill{display:flex;align-items:center;gap:4px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700;color:#10b981;}
.live-dot{width:4px;height:4px;border-radius:50%;background:#10b981;animation:glow 2.5s ease-in-out infinite;}
.sb-sess-row{display:flex;align-items:center;justify-content:space-between;gap:4px;margin-bottom:8px;}
.sb-sess-id{font-size:11px;color:#9ca3af;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;}
.sb-sess-time{font-size:11px;color:#6b7280;font-family:monospace;flex-shrink:0;}
.sb-view-all{display:flex;align-items:center;justify-content:center;font-size:11px;color:#6b7280;padding:6px 10px;border:1px solid rgba(255,255,255,0.07);border-radius:8px;background:rgba(255,255,255,0.02);cursor:pointer;width:100%;box-sizing:border-box;}
.sb-view-all:hover{color:#9ca3af;background:rgba(255,255,255,0.05);}
.sess-dropdown{display:none;flex-direction:column;gap:4px;margin-top:6px;max-height:200px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.05) transparent;}
.sess-dropdown.open{display:flex;}
.sess-item{display:flex;flex-direction:column;gap:2px;padding:7px 10px;border-radius:8px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);}
.sess-item-id{font-size:11px;font-family:monospace;color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sess-item-meta{display:flex;align-items:center;justify-content:space-between;gap:4px;}
.sess-item-proj{font-size:10px;color:#6b7280;}
.sess-item-saved{font-size:10px;font-weight:700;color:#10b981;}
.sess-item-live{width:5px;height:5px;border-radius:50%;background:#10b981;box-shadow:0 0 5px rgba(16,185,129,0.8);flex-shrink:0;animation:glow 2.5s ease-in-out infinite;}
/* ─── MAIN ─── */
.main{display:flex;flex-direction:column;overflow:hidden;background:#0b0d11;}
.header{flex-shrink:0;display:flex;align-items:flex-start;justify-content:space-between;padding:18px 28px 14px;border-bottom:1px solid rgba(255,255,255,0.06);}
.h-title{font-size:24px;font-weight:700;color:#f9fafb;letter-spacing:-0.5px;line-height:1.1;}
.h-sub{font-size:13px;color:#6b7280;margin-top:3px;}
.header-right{display:flex;align-items:center;gap:10px;padding-top:4px;}
.h-chip{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:4px 12px;font-size:12px;color:#9ca3af;}
.h-live{display:flex;align-items:center;gap:5px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:20px;padding:4px 10px;font-size:12px;font-weight:700;color:#10b981;}
.h-live-dot{width:5px;height:5px;border-radius:50%;background:#10b981;animation:glow 2.5s ease-in-out infinite;}
.h-session{font-size:12px;color:#6b7280;font-family:monospace;}
.h-time{font-size:13px;color:#9ca3af;font-weight:600;}
/* Stats row */
.stats{flex-shrink:0;display:grid;grid-template-columns:repeat(4,1fr);}
.stat-card{background:rgba(17,24,39,0.6);backdrop-filter:blur(4px);border-bottom:1px solid rgba(255,255,255,0.05);border-right:1px solid rgba(255,255,255,0.05);padding:16px 22px;position:relative;overflow:hidden;}
.stat-card:last-child{border-right:none;}
.stat-row{display:flex;align-items:flex-start;justify-content:space-between;}
.stat-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#6b7280;}
.stat-val{font-size:30px;font-weight:700;line-height:1;margin-top:8px;letter-spacing:-0.5px;}
.stat-sub{font-size:11px;color:#6b7280;margin-top:5px;}
.sc-green .stat-val{color:#10b981;}
.sc-blue  .stat-val{color:#3b82f6;}
.sc-purple .stat-val{color:#8b5cf6;}
.sc-amber  .stat-val{color:#f59e0b;}
.sc-green::after{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 80% 100% at 0 60%,rgba(16,185,129,0.07),transparent);pointer-events:none;}
.sc-blue::after{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 80% 100% at 0 60%,rgba(59,130,246,0.07),transparent);pointer-events:none;}
.sc-purple::after{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 80% 100% at 0 60%,rgba(139,92,246,0.07),transparent);pointer-events:none;}
.sc-amber::after{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 80% 100% at 0 60%,rgba(245,158,11,0.07),transparent);pointer-events:none;}
/* Compression overview */
.ov-card{flex-shrink:0;background:rgba(17,24,39,0.6);backdrop-filter:blur(4px);border-bottom:1px solid rgba(255,255,255,0.05);padding:18px 28px 0;}
.ov-hdr{display:flex;align-items:center;gap:6px;margin-bottom:14px;}
.ov-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;color:#6b7280;}
.ov-info{color:#4b5563;cursor:default;}
.ov-body{display:flex;align-items:center;gap:20px;}
.ov-num-pair{display:flex;gap:28px;flex-shrink:0;}
.ov-num-col{display:flex;flex-direction:column;}
.ov-num-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#6b7280;margin-bottom:4px;}
.ov-big{font-size:36px;font-weight:700;line-height:1;letter-spacing:-1.5px;}
.ov-big.orig{color:rgba(249,250,251,0.5);}
.ov-big.opt{color:#3b82f6;}
.ov-tok-sub{font-size:11px;color:#6b7280;margin-top:3px;}
.ov-viz{flex:1;display:flex;align-items:center;gap:10px;min-width:0;}
.ov-seg-bar{flex:1;height:42px;display:flex;gap:3px;align-items:stretch;border-radius:6px;overflow:hidden;min-width:0;}
.ov-seg{border-radius:3px;flex-shrink:0;}
.ov-arr{font-size:18px;color:#6b7280;flex-shrink:0;padding:0 2px;}
.ov-green-bar{width:72px;height:42px;display:flex;gap:3px;align-items:stretch;border-radius:6px;overflow:hidden;flex-shrink:0;}
.ov-ring-wrap{flex-shrink:0;display:flex;flex-direction:column;align-items:center;}
.ov-ring{position:relative;width:148px;height:148px;}
.ov-ring svg{transform:rotate(-90deg);}
.ov-ring-inner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}
.ov-pct{font-size:28px;font-weight:700;color:#10b981;letter-spacing:-0.5px;}
.ov-pct-sub{font-size:10px;color:#6b7280;font-weight:600;}
.ov-banner{display:flex;align-items:center;justify-content:space-between;margin-top:14px;margin-bottom:12px;padding:10px 16px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.15);border-radius:6px;}
.ov-banner-l{display:flex;align-items:center;gap:8px;font-size:12px;color:#f9fafb;}
.ov-banner-chk{color:#10b981;font-weight:700;}
.ov-banner-r{display:flex;align-items:center;gap:6px;font-size:12px;color:#10b981;font-weight:600;}
/* Bottom */
.bottom{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:16px;overflow:hidden;background:transparent;padding:12px 24px 12px;}
/* Table */
.tbl-card{display:flex;flex-direction:column;overflow:hidden;padding:16px 18px 12px;background:#0d1117;border:1px solid rgba(255,255,255,0.08);border-radius:8px;}
.tbl-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;color:#6b7280;margin-bottom:10px;flex-shrink:0;}
.tbl-scroll{flex:1;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.04) transparent;}
.tbl-scroll::-webkit-scrollbar{width:2px;}
table{width:100%;border-collapse:collapse;}
thead th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;padding:0 8px 8px 0;text-align:left;border-bottom:1px solid rgba(255,255,255,0.05);}
thead th:first-child{padding-left:0;}
thead th.th-r{text-align:right;padding-right:0;}
tbody tr{border-bottom:1px solid rgba(255,255,255,0.04);}
tbody tr:last-child{border-bottom:none;}
tbody td{padding:7px 8px 7px 0;vertical-align:middle;font-size:13px;color:#9ca3af;}
tbody td:first-child{padding-left:0;}
.td-tool{display:flex;align-items:center;gap:8px;}
.td-icon-box{width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;}
.td-name{font-size:13px;font-weight:600;color:#f9fafb;}
.td-saved{color:#10b981;font-weight:700;}
.td-share{display:flex;align-items:center;gap:6px;justify-content:flex-end;}
.td-share-bar{width:44px;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;}
.td-share-fill{height:100%;border-radius:2px;background:#3b82f6;}
.td-share-pct{font-size:12px;font-weight:700;color:#9ca3af;min-width:30px;text-align:right;}
.tr-total{border-top:1px solid rgba(255,255,255,0.08)!important;background:rgba(255,255,255,0.02);}
.tr-total td{padding-top:9px!important;padding-bottom:9px!important;font-weight:600;color:#9ca3af;}
/* Activity */
.act-card{display:flex;flex-direction:column;overflow:hidden;padding:16px 18px 12px;background:#0d1117;border:1px solid rgba(255,255,255,0.08);border-radius:8px;}
.act-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-shrink:0;}
.act-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;color:#6b7280;}
.act-view{font-size:11px;color:#3b82f6;text-decoration:none;}
.act-view:hover{text-decoration:underline;}
.act-list{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.04) transparent;}
.act-list::-webkit-scrollbar{width:2px;}
.act-row{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);}
.act-icon-box{width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;}
.act-body{flex:1;min-width:0;}
.act-verb{font-size:10px;color:#6b7280;text-transform:capitalize;}
.act-name{font-size:12px;font-weight:600;color:#f9fafb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.act-right{flex-shrink:0;text-align:right;}
.act-saved-v{font-size:12px;font-weight:700;color:#10b981;white-space:nowrap;}
.act-saved-v.none{color:#4b5563;}
.act-time{font-size:10px;color:#4b5563;}
/* Footer */
.footer{flex-shrink:0;height:36px;display:flex;align-items:center;padding:0 24px;border-top:1px solid rgba(255,255,255,0.12);background:#060810;}
.footer-l{display:flex;align-items:center;gap:7px;flex:1;}
.footer-zap{color:#3b82f6;}
.footer-txt{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.1px;color:#3b82f6;}
.footer-r{display:flex;align-items:center;gap:6px;}
.footer-dot{width:5px;height:5px;border-radius:50%;background:#10b981;animation:glow 2.5s ease-in-out infinite;}
.footer-uptime{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;}
/* Empty states */
.empty-s{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:6px;opacity:0.4;padding:16px;text-align:center;}
.empty-s-icon{font-size:20px;}
.empty-s-txt{font-size:12px;color:#6b7280;}
</style>
</head>
<body>

<!-- SIDEBAR -->
<aside class="sb">
  <div class="sb-logo-row">
    <div class="sb-logo"><img src="/logo.webp" alt="TokenSage"/></div>
    <span class="sb-brand-name"><span class="sb-brand-token">Token</span><span class="sb-brand-sage">Sage</span></span>
  </div>
  <div class="sb-status">
    <div class="sb-status-lbl">MCP Status</div>
    <div class="sb-status-row">
      <div class="mcp-dot" id="mcp-dot"></div>
      <span class="mcp-txt" id="mcp-txt">Checking\u2026</span>
    </div>
  </div>
  <div class="sb-cards">
    <div class="sb-card">
      <div class="sb-card-lbl">Model</div>
      <div class="sb-card-val" id="sb-model-val">${modelIconSvg(MODEL_NAME)}${safeModel}</div>
    </div>
    <div class="sb-card">
      <div class="sb-card-lbl">Current Project</div>
      <div class="sb-card-val">${safeProjectName}</div>
    </div>
    <div class="sb-card">
      <div class="sb-card-lbl">Files Processed</div>
      <div class="sb-card-val" id="sb-files">\u2014</div>
    </div>
  </div>
  <div class="sb-tools-section">
    <div class="sb-sect-hdr">Active Tools</div>
    <div class="sb-tools-list" id="sb-tools"><div class="sb-empty-txt">No tool activity yet</div></div>
  </div>
  <div class="sb-footer">
    <div class="sb-footer-hdr">
      <span class="sb-footer-lbl">Active Session</span>
      <div class="live-pill"><div class="live-dot"></div>Live</div>
    </div>
    <div class="sb-sess-row">
      <span class="sb-sess-id" id="sb-sess-id">\u2014</span>
      <span class="sb-sess-time" id="sb-sess-time">\u2014</span>
    </div>
    <button class="sb-view-all" id="sess-toggle" onclick="toggleSessions()">View All Sessions</button>
    <div class="sess-dropdown" id="sess-dropdown"></div>
  </div>
</aside>

<!-- MAIN -->
<div class="main">

  <!-- Header -->
  <div class="header">
    <div>
      <div class="h-title">Dashboard</div>
      <div class="h-sub">Real-time overview of your token optimization</div>
    </div>
    <div class="header-right">
      <span class="h-chip">${safeProjectName}</span>
      <div class="h-live"><div class="h-live-dot"></div>Live</div>
      <span class="h-session" id="top-sid">Session: \u2014</span>
      <span class="h-time" id="top-time">\u2014</span>
    </div>
  </div>

  <!-- Stats -->
  <div class="stats">
    <div class="stat-card sc-green">
      <div class="stat-row"><div class="stat-lbl">Tokens Saved</div><svg width="56" height="24" id="spark-saved"></svg></div>
      <div class="stat-val" id="sc-saved">0</div>
      <div class="stat-sub" id="sc-saved-sub">This session</div>
    </div>
    <div class="stat-card sc-blue">
      <div class="stat-row"><div class="stat-lbl">Optimization</div><svg width="56" height="24" id="spark-pct"></svg></div>
      <div class="stat-val" id="sc-pct">0%</div>
      <div class="stat-sub">Avg reduction</div>
    </div>
    <div class="stat-card sc-purple">
      <div class="stat-row"><div class="stat-lbl">Requests</div><svg width="56" height="24" id="spark-reqs"></svg></div>
      <div class="stat-val" id="sc-reqs">0</div>
      <div class="stat-sub">This session</div>
    </div>
    <div class="stat-card sc-amber">
      <div class="stat-row"><div class="stat-lbl">Time Saved</div><svg width="56" height="24" id="spark-time"></svg></div>
      <div class="stat-val" id="sc-time">0m</div>
      <div class="stat-sub">Est. dev time</div>
    </div>
  </div>

  <!-- Content -->
  <div style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;">

    <!-- Compression Overview -->
    <div class="ov-card">
      <div class="ov-hdr">
        <span class="ov-title">Compression Overview</span>
        <svg class="ov-info" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      </div>
      <div id="ov-body" class="ov-body">
        <div class="ov-num-pair">
          <div class="ov-num-col">
            <div class="ov-num-lbl">Original Context</div>
            <div class="ov-big orig" id="ov-orig">\u2014</div>
            <div class="ov-tok-sub" id="ov-orig-sub">tokens</div>
          </div>
          <div class="ov-num-col">
            <div class="ov-num-lbl">Optimized Context</div>
            <div class="ov-big opt" id="ov-opt">\u2014</div>
            <div class="ov-tok-sub" id="ov-opt-sub">tokens</div>
          </div>
        </div>
        <div class="ov-viz">
          <div class="ov-seg-bar" id="ov-segs"><div style="flex:1;background:rgba(255,255,255,0.04);border-radius:4px;"></div></div>
          <div class="ov-arr">\u2192</div>
          <div class="ov-green-bar" id="ov-green"><div style="flex:1;background:rgba(16,185,129,0.15);border-radius:4px;"></div></div>
        </div>
        <div class="ov-ring-wrap">
          <div class="ov-ring">
            <svg width="148" height="148" viewBox="0 0 148 148">
              <circle cx="74" cy="74" r="60" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="12"/>
              <circle id="ring-arc" cx="74" cy="74" r="60" fill="none" stroke="#10b981" stroke-width="12" stroke-linecap="round" stroke-dasharray="376.99" stroke-dashoffset="376.99"/>
            </svg>
            <div class="ov-ring-inner"><div class="ov-pct" id="ring-pct">0%</div><div class="ov-pct-sub">reduction</div></div>
          </div>
        </div>
      </div>
      <div class="ov-banner" id="ov-banner" style="display:none">
        <div class="ov-banner-l"><span class="ov-banner-chk">\u2713</span> <span id="ov-banner-saved">You saved 0 tokens this session</span></div>
        <div class="ov-banner-r"><span id="ov-banner-pct">That\u2019s 0% more efficient context</span> <span class="ov-banner-chk">\u2713</span></div>
      </div>
    </div>

    <!-- Bottom row -->
    <div class="bottom">

      <!-- Tool Effectiveness -->
      <div class="tbl-card">
        <div class="tbl-title">Tool Effectiveness</div>
        <div class="tbl-scroll">
          <div id="tbl-body"><div class="empty-s"><div class="empty-s-icon">&#128295;</div><div class="empty-s-txt">No tool usage yet</div></div></div>
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="act-card">
        <div class="act-hdr">
          <span class="act-title">Recent Activity</span>
          <a class="act-view" href="#">View All</a>
        </div>
        <div class="act-list" id="act-feed">
          <div class="empty-s"><div class="empty-s-icon">&#128225;</div><div class="empty-s-txt">No activity yet</div></div>
        </div>
      </div>

    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div class="footer-l">
      <svg class="footer-zap" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
      <span class="footer-txt">TokenSage is actively optimizing your context in real time</span>
    </div>
    <div class="footer-r">
      <div class="footer-dot"></div>
      <span class="footer-uptime" id="footer-uptime">\u2014</span>
    </div>
  </div>

</div>

<script>
const TM={
  auto_compress_read:{icon:'\u{1F4C4}',verb:'Compressed',color:'#8b5cf6',bg:'rgba(139,92,246,0.15)'},
  read_operation:    {icon:'\u{1F4C4}',verb:'Read',      color:'#6b7280',bg:'rgba(107,114,128,0.15)'},
  write_guard:       {icon:'\u{1F6E1}',verb:'Guarded',   color:'#3b82f6',bg:'rgba(59,130,246,0.15)'},
  user_prompt:       {icon:'\u{1F4AC}',verb:'Prompted',  color:'#10b981',bg:'rgba(16,185,129,0.15)'},
  edit_operation:    {icon:'\u270F',   verb:'Edited',    color:'#3b82f6',bg:'rgba(59,130,246,0.15)'},
  write_operation:   {icon:'\u{1F4DD}',verb:'Written',   color:'#f59e0b',bg:'rgba(245,158,11,0.15)'},
  bash_operation:    {icon:'\u26A1',   verb:'Executed',  color:'#ef4444',bg:'rgba(239,68,68,0.15)'},
  compress_file:     {icon:'\u{1F5DC}',verb:'Compressed',color:'#8b5cf6',bg:'rgba(139,92,246,0.15)'},
  compress_directory:{icon:'\u{1F4C1}',verb:'Compressed',color:'#3b82f6',bg:'rgba(59,130,246,0.15)'},
  summarize_logs:    {icon:'\u{1F4CB}',verb:'Summarized',color:'#10b981',bg:'rgba(16,185,129,0.15)'},
  semantic_relevance:{icon:'\u{1F50D}',verb:'Ranked',    color:'#3b82f6',bg:'rgba(59,130,246,0.15)'},
  detect_duplicates: {icon:'\u{1F504}',verb:'Deduped',   color:'#f59e0b',bg:'rgba(245,158,11,0.15)'},
  context_budget:    {icon:'\u{1F4B0}',verb:'Budgeted',  color:'#9ca3af',bg:'rgba(156,163,175,0.15)'},
};
const BAR_COLORS=['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4'];
const C=2*Math.PI*60;
let startTime=Date.now();
let sparkData={saved:[],pct:[],reqs:[],time:[]};
let _lastModel='';

function modelIcon(name){
  const m=(name||'').toLowerCase();
  if(m.includes('claude')) return '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" style="flex-shrink:0"><g transform="translate(9,9)">'+[0,1,2,3,4,5,6,7].map(i=>'<rect x="-1.1" y="-8.2" width="2.2" height="5.2" rx="1.1" fill="#e8784d" transform="rotate('+(i*45)+')"/>').join('')+'</g></svg>';
  if(m.includes('gpt')||m.includes('codex')||m.includes('o1')||m.includes('o3')||m.includes('o4')) return '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" style="flex-shrink:0"><path d="M9 2.5a6.5 6.5 0 1 1 0 13A6.5 6.5 0 0 1 9 2.5z" stroke="#10b981" stroke-width="1.5"/><path d="M6 9c0-1.66 1.34-3 3-3s3 1.34 3 3-1.34 3-3 3" stroke="#10b981" stroke-width="1.5" stroke-linecap="round"/><circle cx="9" cy="9" r="1.2" fill="#10b981"/></svg>';
  if(m.includes('cursor')) return '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" style="flex-shrink:0"><path d="M4 3l10 6-5.5 1.5L7 16 4 3z" stroke="#3b82f6" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  if(m.includes('gemini')||m.includes('google')) return '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" style="flex-shrink:0"><path d="M9 2L14 9L9 16L4 9Z" stroke="#4285f4" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 2C9 2 11 5.5 11 9C11 12.5 9 16 9 16" stroke="#ea4335" stroke-width="1.2"/><path d="M9 2C9 2 7 5.5 7 9C7 12.5 9 16 9 16" stroke="#34a853" stroke-width="1.2"/></svg>';
  if(m.includes('llama')||m.includes('meta')) return '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" style="flex-shrink:0"><path d="M3 9c0-2 1.5-3.5 3-3.5S8.5 7 9 9s1.5 3.5 3 3.5 3-1.5 3-3.5-1.5-3.5-3-3.5S8.5 11 8 9 6.5 5.5 6 5.5 3 7 3 9z" stroke="#8b5cf6" stroke-width="1.5"/></svg>';
  if(m.includes('mistral')) return '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" style="flex-shrink:0"><rect x="3" y="4" width="4" height="4" rx="0.5" fill="#f59e0b"/><rect x="11" y="4" width="4" height="4" rx="0.5" fill="#f59e0b"/><rect x="7" y="8" width="4" height="4" rx="0.5" fill="#f59e0b" opacity="0.7"/><rect x="3" y="12" width="4" height="2" rx="0.5" fill="#f59e0b" opacity="0.5"/><rect x="11" y="12" width="4" height="2" rx="0.5" fill="#f59e0b" opacity="0.5"/></svg>';
  if(m.includes('deepseek')) return '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" style="flex-shrink:0"><path d="M2 9c2-4 12-4 14 0-2 4-12 4-14 0z" stroke="#06b6d4" stroke-width="1.5"/><circle cx="9" cy="9" r="2.5" stroke="#06b6d4" stroke-width="1.5"/><circle cx="9" cy="9" r="1" fill="#06b6d4"/></svg>';
  return '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" style="flex-shrink:0"><circle cx="9" cy="9" r="6" stroke="#6b7280" stroke-width="1.5"/><circle cx="9" cy="9" r="2" fill="#6b7280"/></svg>';
}

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function fmt(n){n=Number(n)||0;if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1000)return(n/1000).toFixed(1)+'k';return String(n);}
function fmtN(n){return Number(n).toLocaleString();}
function ago(iso){const s=Math.floor((Date.now()-new Date(iso).getTime())/1000);if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';return Math.floor(s/3600)+'h ago';}
function tm(k){return TM[k]||{icon:'\u25C6',verb:'Processed',color:'#9ca3af',bg:'rgba(156,163,175,0.15)'};}
function timeSaved(t){const m=Math.round(t/300);if(m<1)return '<1m';if(m<60)return m+'m';return(m/60).toFixed(1)+'h';}
function uptime(){const s=Math.floor((Date.now()-startTime)/1000);const h=Math.floor(s/3600),m=Math.floor(s/60)%60,sec=s%60;if(h>0)return h+'h '+m+'m uptime';if(m>0)return m+'m '+sec+'s uptime';return sec+'s uptime';}

function sparkline(data,color,id){
  const el=document.getElementById(id);if(!el||data.length<2)return;
  const W=56,H=24,p=2;
  const mn=Math.min(...data),mx=Math.max(...data);
  const range=mx-mn||1;
  const pts=data.map((v,i)=>{
    const x=p+i/(data.length-1)*(W-2*p);
    const y=H-p-((v-mn)/range)*(H-2*p);
    return x.toFixed(1)+','+y.toFixed(1);
  });
  el.innerHTML='<polyline points="'+pts.join(' ')+'" fill="none" stroke="'+color+'" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>';
}

function buildSbTools(tools){
  const active=(tools||[]).filter(t=>t.savedTokens>0);
  if(!active.length) return '<div class="sb-empty-txt">No tool activity yet</div>';
  let html=active.slice(0,5).map(t=>{
    const m=tm(t.tool);
    return '<div class="tool-row">'+
      '<div class="tool-icon-box" style="background:'+m.bg+';color:'+m.color+'">'+m.icon+'</div>'+
      '<span class="tool-name">'+esc(t.tool.replace(/_/g,' '))+'</span>'+
      '<div class="tool-active-dot"></div></div>';
  }).join('');
  const extra=active.length-5;
  if(extra>0) html+='<div class="sb-empty-txt">+ '+extra+' more</div>';
  return html;
}

function buildOv(s,tools){
  const pct=Math.min(s.savedPercent||0,100);
  const off=(C-(pct/100)*C).toFixed(1);

  // Update big numbers always
  const origEl=document.getElementById('ov-orig');
  const optEl=document.getElementById('ov-opt');
  if(origEl) origEl.textContent=s.totalOriginalTokens?fmtN(s.totalOriginalTokens):'\u2014';
  if(optEl) optEl.textContent=s.totalOptimizedTokens?fmtN(s.totalOptimizedTokens):'\u2014';

  // Update ring arc
  const arc=document.getElementById('ring-arc');
  if(arc) arc.setAttribute('stroke-dashoffset',off);
  const rp=document.getElementById('ring-pct');
  if(rp) rp.textContent=pct+'%';

  // Segmented bars — one colored block per tool, flex proportional to savedTokens
  const active=tools.filter(t=>t.savedTokens>0).slice(0,8);
  const segsEl=document.getElementById('ov-segs');
  const greenEl=document.getElementById('ov-green');
  if(segsEl){
    if(!active.length){
      segsEl.innerHTML='<div style="flex:1;background:rgba(255,255,255,0.04);border-radius:4px;"></div>';
    } else {
      const tot=active.reduce((a,t)=>a+t.savedTokens,0)||1;
      segsEl.innerHTML=active.map((t,i)=>{
        const col=BAR_COLORS[i%BAR_COLORS.length];
        const flex=Math.max(1,Math.round((t.savedTokens/tot)*100));
        return '<div class="ov-seg" style="flex:'+flex+';background:'+col+';opacity:0.85;" title="'+esc(t.tool)+'"></div>';
      }).join('');
    }
  }
  // Green bar — proportional to optimized/original ratio
  if(greenEl){
    const ratio=s.totalOriginalTokens>0?(s.totalOptimizedTokens/s.totalOriginalTokens):0.5;
    const seg1=Math.round(ratio*70);
    const seg2=Math.round(ratio*30);
    greenEl.innerHTML=
      '<div class="ov-seg" style="flex:'+Math.max(1,seg1)+';background:#10b981;opacity:0.9;border-radius:3px;"></div>'+
      '<div class="ov-seg" style="flex:'+Math.max(1,seg2)+';background:#059669;opacity:0.7;border-radius:3px;"></div>';
  }

  // Banner
  const banner=document.getElementById('ov-banner');
  if(banner){
    if(s.totalSavedTokens>0){
      banner.style.display='flex';
      const bSaved=document.getElementById('ov-banner-saved');
      const bPct=document.getElementById('ov-banner-pct');
      if(bSaved) bSaved.textContent='You saved '+fmtN(s.totalSavedTokens)+' tokens this session';
      if(bPct) bPct.textContent="That\u2019s "+pct+'% more efficient context';
    } else {
      banner.style.display='none';
    }
  }
}

function buildTbl(s,tools){
  const active=(tools||[]).filter(t=>t.savedTokens>0);
  if(!active.length) return '<div class="empty-s"><div class="empty-s-icon">&#128295;</div><div class="empty-s-txt">No tool usage yet</div></div>';
  const totalSaved=active.reduce((a,t)=>a+t.savedTokens,0)||1;
  const totalCalls=active.reduce((a,t)=>a+(s.toolUsage&&s.toolUsage[t.tool]||0),0);
  const rows=active.map(t=>{
    const m=tm(t.tool);
    const calls=(s.toolUsage&&s.toolUsage[t.tool])||0;
    const share=Math.round((t.savedTokens/totalSaved)*100);
    return '<tr>'+
      '<td><div class="td-tool">'+
        '<div class="td-icon-box" style="background:'+m.bg+';border:1px solid '+m.color+'40">'+m.icon+'</div>'+
        '<span class="td-name">'+esc(t.tool.replace(/_/g,' '))+'</span></div></td>'+
      '<td>'+calls+'</td>'+
      '<td class="td-saved">+'+fmt(t.savedTokens)+'</td>'+
      '<td><div class="td-share"><div class="td-share-bar"><div class="td-share-fill" style="width:'+share+'%"></div></div><span class="td-share-pct">'+share+'%</span></div></td>'+
    '</tr>';
  }).join('');
  return '<table><thead><tr><th>Tool</th><th>Calls</th><th>Tokens Saved</th><th class="th-r">Share</th></tr></thead><tbody>'+
    rows+
    '<tr class="tr-total"><td><strong>Total</strong></td><td>'+totalCalls+'</td><td class="td-saved">+'+fmt(totalSaved)+'</td><td></td></tr>'+
    '</tbody></table>';
}

function buildAct(activity){
  if(!activity||!activity.length) return '<div class="empty-s"><div class="empty-s-icon">&#128225;</div><div class="empty-s-txt">No activity yet</div></div>';
  return activity.map(r=>{
    const m=tm(r.tool);
    const saved=r.savedTokens>0?'+'+fmt(r.savedTokens)+' tokens':'\u2014';
    const cls=r.savedTokens>0?'act-saved-v':'act-saved-v none';
    return '<div class="act-row">'+
      '<div class="act-icon-box" style="background:'+m.bg+';border:1px solid '+m.color+'40;color:'+m.color+'">'+m.icon+'</div>'+
      '<div class="act-body">'+
        '<div class="act-verb">'+m.verb+'</div>'+
        '<div class="act-name">'+esc(r.target||r.tool.replace(/_/g,' '))+'</div>'+
      '</div>'+
      '<div class="act-right"><div class="'+cls+'">'+saved+'</div><div class="act-time">'+ago(r.timestamp)+'</div></div>'+
    '</div>';
  }).join('');
}

function tick(){
  const now=new Date().toLocaleTimeString();
  document.getElementById('top-time').textContent=now;
  document.getElementById('sb-sess-time').textContent=now;
  document.getElementById('footer-uptime').textContent='MCP Server Uptime: '+uptime();
}

async function refresh(){
  tick();
  try{
    const d=await fetch('/api/stats').then(r=>r.json());
    const s=d.session,tools=d.topTools||[],act=d.recentActivity||[];
    if(d.model&&d.model!==_lastModel){_lastModel=d.model;const el=document.getElementById('sb-model-val');if(el)el.innerHTML=modelIcon(d.model)+esc(d.model);}
    document.getElementById('top-sid').textContent='Session: '+(s.sessionId?s.sessionId.slice(0,8):'\u2014');
    document.getElementById('sb-sess-id').textContent=s.sessionId?s.sessionId.slice(0,14)+'\u2026':'\u2014';
    document.getElementById('sb-files').textContent=String(s.totalRequests||0);
    const saved=s.totalSavedTokens||0,pct=s.savedPercent||0,reqs=s.totalRequests||0;
    document.getElementById('sc-saved').textContent=fmt(saved);
    document.getElementById('sc-saved-sub').textContent='All-time: '+fmt(d.allTimeSaved||0);
    document.getElementById('sc-pct').textContent=pct+'%';
    document.getElementById('sc-reqs').textContent=reqs;
    document.getElementById('sc-time').textContent=timeSaved(saved);
    sparkData.saved.push(saved);sparkData.saved=sparkData.saved.slice(-20);
    sparkData.pct.push(pct);sparkData.pct=sparkData.pct.slice(-20);
    sparkData.reqs.push(reqs);sparkData.reqs=sparkData.reqs.slice(-20);
    sparkData.time.push(Math.round(saved/300));sparkData.time=sparkData.time.slice(-20);
    sparkline(sparkData.saved,'#10b981','spark-saved');
    sparkline(sparkData.pct,'#3b82f6','spark-pct');
    sparkline(sparkData.reqs,'#8b5cf6','spark-reqs');
    sparkline(sparkData.time,'#f59e0b','spark-time');
    buildOv(s,tools);
    document.getElementById('tbl-body').innerHTML=buildTbl(s,tools);
    document.getElementById('act-feed').innerHTML=buildAct(act);
    document.getElementById('sb-tools').innerHTML=buildSbTools(tools);
  }catch(e){console.error('stats err',e);}
  try{
    const dr=await fetch('/api/daemon-status').then(r=>r.json());
    const ok=dr.daemon?.status==='running';
    document.getElementById('mcp-dot').className='mcp-dot'+(ok?'':' offline');
    const t=document.getElementById('mcp-txt');
    t.className='mcp-txt'+(ok?'':' offline');
    t.textContent=ok?'Connected':'Offline';
    // Pull all-time total from daemon project list (more accurate than session tracker)
    const proj=(dr.projects||[]).find(p=>p.name==='${safeProjectName}');
    if(proj&&proj.totalSavedTokens>0){
      document.getElementById('sc-saved-sub').textContent='All-time: '+fmt(proj.totalSavedTokens);
    }
  }catch(e){
    document.getElementById('mcp-dot').className='mcp-dot offline';
    const t=document.getElementById('mcp-txt');t.className='mcp-txt offline';t.textContent='Offline';
  }
}

function fmtTime(iso){
  const d=new Date(iso);
  return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
}
async function toggleSessions(){
  const dd=document.getElementById('sess-dropdown');
  if(dd.classList.contains('open')){dd.classList.remove('open');return;}
  dd.innerHTML='<div class="sess-item"><div class="sess-item-id">Loading\u2026</div></div>';
  dd.classList.add('open');
  try{
    const dr=await fetch('/api/daemon-status').then(r=>r.json());
    const allSess=(dr.sessions||[]);
    const now=Date.now();
    // filter sessions older than 48h
    const valid=allSess.filter(s=>now-new Date(s.lastActivityAt).getTime()<48*60*60*1000);
    if(!valid.length){dd.innerHTML='<div class="sess-item"><div class="sess-item-id" style="color:#4b5563">No sessions</div></div>';return;}
    dd.innerHTML=valid.map(s=>{
      const isLive=s.id==='${dashboardSessionId}';
      return '<div class="sess-item">'+
        '<div class="sess-item-id">'+(isLive?'<div class="sess-item-live" style="display:inline-block;margin-right:5px;vertical-align:middle"></div>':'')+s.id+'</div>'+
        '<div class="sess-item-meta">'+
          '<span class="sess-item-proj">'+esc(s.projectName||s.id)+'</span>'+
          '<span class="sess-item-saved">'+fmt(s.savedTokens||0)+' saved</span>'+
        '</div>'+
      '</div>';
    }).join('');
  }catch(e){dd.innerHTML='<div class="sess-item"><div class="sess-item-id" style="color:#ef4444">Error loading</div></div>';}
}

refresh();
setInterval(refresh,5000);
setInterval(tick,1000);
</script>
</body>
</html>
`;
}



const DAEMON_PORT = 7099;
const projectPath = process.env["PROJECT_PATH"] ?? process.cwd();
// Stable ID based on projectPath — re-attaching replaces same record, no accumulation
import { createHash as _createHash } from "node:crypto";
const dashboardSessionId = _createHash("sha256").update(projectPath).digest("hex").slice(0, 16);

async function attachSessionToDaemon(projectName: string, projectId: string): Promise<void> {
  try {
    await fetch(`http://localhost:${DAEMON_PORT}/sessions/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: dashboardSessionId,
        projectId,
        projectPath,
        projectName,
        pid: process.pid,
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch { /* daemon not running yet — non-fatal */ }
}

async function detachSessionFromDaemon(): Promise<void> {
  try {
    await fetch(`http://localhost:${DAEMON_PORT}/sessions/detach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: dashboardSessionId }),
      signal: AbortSignal.timeout(1000),
    });
  } catch { /* non-fatal */ }
}

async function syncSavingsToDaemon(savedTokens: number): Promise<void> {
  if (savedTokens <= 0) return;
  fetch(`http://localhost:${DAEMON_PORT}/sessions/track-savings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectPath, savedTokens }),
    signal: AbortSignal.timeout(1000),
  }).catch(() => {});
}

export async function startDashboard(
  port = DEFAULT_CONFIG.dashboard.port,
  projectName = DEFAULT_CONFIG.dashboard.projectName,
): Promise<void> {
  const url = `http://localhost:${port}`;
  const fastify = Fastify({ logger: false });
  // Stats API
  fastify.get("/api/stats", async () => {
    const session = sessionTracker.getSessionStats();
    const topTools = sessionTracker.getTopSavingTools(10);
    const allTimeSaved = sessionTracker.getAllTimeSaved();
    const recentActivity = sessionTracker.getRecentActivity(20);
    const model = readModelFromSettings();
    return { session, topTools, allTimeSaved, recentActivity, model };
  });

  // Track endpoint — hooks POST token events here
  fastify.post("/api/track", async (req) => {
    const { tool, tokens, target } = req.body as { tool: string; tokens: { original: number; optimized: number; saved: number; savedPercent: number }; target?: string };
    sessionTracker.record(tool, tokens, target);
    if (tokens.saved > 0) syncSavingsToDaemon(tokens.saved);
    return { ok: true };
  });

  // Proxy to daemon for project list
  fastify.get("/api/projects", async () => {
    try {
      const res = await fetch("http://localhost:7099/projects", { signal: AbortSignal.timeout(1000) });
      return res.ok ? res.json() : { projects: [] };
    } catch { return { projects: [] }; }
  });

  // Daemon status proxy
  fastify.get("/api/daemon-status", async () => {
    try {
      const res = await fetch("http://localhost:7099/status", { signal: AbortSignal.timeout(1000) });
      return res.ok ? res.json() : { daemon: { status: "not running" } };
    } catch { return { daemon: { status: "not running" } }; }
  });

  // Serve logo from public folder
  fastify.get("/logo.webp", async (_req, reply) => {
    try {
      const img = readFileSync(LOGO_PATH);
      reply.type("image/webp").send(img);
    } catch {
      reply.code(404).send("not found");
    }
  });

  // Health check
  fastify.get("/health", async () => ({ status: "ok", service: "token-sage-dashboard", project: projectName, port }));

  // Dashboard HTML — rebuild each request so updates reflect without restart
  fastify.get("/", async (_req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .type("text/html")
      .send(buildDashboardHtml(projectName));
  });

  try {
    await fastify.listen({ port, host: DEFAULT_CONFIG.dashboard.host });
    console.error(`[TokenSage] Dashboard: ${url} (${projectName})`);

    // Compute projectId the same way daemon does
    const { createHash } = await import("node:crypto");
    const projectId = createHash("sha256").update(projectPath).digest("hex").slice(0, 8);

    // Attach session now, and re-attach every 60s (survives daemon restarts)
    await attachSessionToDaemon(projectName, projectId);
    setInterval(() => attachSessionToDaemon(projectName, projectId), 60_000).unref();

    // Detach cleanly on exit
    process.on("SIGTERM", async () => { await detachSessionFromDaemon(); process.exit(0); });
    process.on("SIGINT",  async () => { await detachSessionFromDaemon(); process.exit(0); });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "EADDRINUSE") {
      console.error(`[TokenSage] Dashboard already running at ${url}`);
    } else {
      throw err;
    }
  }

  // Browser is opened by the session-start hook (which has the project cwd context)
}


// Self-invoke when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startDashboard();
}

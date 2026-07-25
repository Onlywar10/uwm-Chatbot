import { initBotId } from "botid/client/core";

// BotID client instrumentation: attaches an invisible bot-detection proof to the
// widget's POST /api/chat so the server can reject automated/scripted clients. Runs on
// every first-party page (including the /widget/[id] iframe). Locally it's a no-op
// (the dev bypass returns HUMAN), and the server-side check fails open, so a BotID
// outage can never take chat down.
initBotId({
	protect: [{ path: "/api/chat", method: "POST" }],
});

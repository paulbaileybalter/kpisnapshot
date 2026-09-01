import { isAuthenticated, json } from "./lib/auth.js";

import { onRequestGet as sessionGet } from "./routes/session.js";
import { onRequestPost as loginPost, onRequestOptions as loginOptions } from "./routes/login.js";
import { onRequestPost as logoutPost } from "./routes/logout.js";
import { onRequestGet as dataGet, onRequestPost as dataPost } from "./routes/data.js";
import { onRequestGet as dataMonthGet } from "./routes/data-month.js";
import { onRequestGet as priorYearGet, onRequestPost as priorYearPost } from "./routes/prioryear.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname === "/api/session" && request.method === "GET") {
        return await sessionGet({ request, env });
      }

      if (pathname === "/api/login") {
        if (request.method === "POST") return await loginPost({ request, env });
        if (request.method === "OPTIONS") return await loginOptions();
      }

      if (pathname === "/api/logout" && request.method === "POST") {
        return await logoutPost({ request, env });
      }

      // Everything under /api/data/* and /api/prioryear requires a valid
      // session — this is the equivalent of the old Pages Functions
      // _middleware.js guard.
      if (pathname === "/api/data" || pathname.startsWith("/api/data/") || pathname === "/api/prioryear") {
        const authed = await isAuthenticated(request, env);
        if (!authed) return json({ ok: false, error: "Not authenticated." }, { status: 401 });

        if (pathname === "/api/prioryear" && request.method === "GET") {
          return await priorYearGet({ env });
        }
        if (pathname === "/api/prioryear" && request.method === "POST") {
          return await priorYearPost({ request, env });
        }
        if (pathname === "/api/data" && request.method === "GET") {
          return await dataGet({ env });
        }
        if (pathname === "/api/data" && request.method === "POST") {
          return await dataPost({ request, env });
        }
        const monthMatch = pathname.match(/^\/api\/data\/([^/]+)$/);
        if (monthMatch && request.method === "GET") {
          return await dataMonthGet({ env, params: { month: decodeURIComponent(monthMatch[1]) } });
        }
        return json({ ok: false, error: "Not found." }, { status: 404 });
      }

      if (pathname.startsWith("/api/")) {
        return json({ ok: false, error: "Not found." }, { status: 404 });
      }
    } catch (err) {
      return json({ ok: false, error: "Server error." }, { status: 500 });
    }

    // Anything that isn't an /api/* route is a static asset (index.html,
    // styles.css, app.js, icons, the vendored xlsx library, etc.) served
    // from the `public/` directory via the ASSETS binding.
    return env.ASSETS.fetch(request);
  },
};

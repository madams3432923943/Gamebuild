# Legal checklist

What the code cannot do for itself. The documents under `legal/` are live and
correct in substance, but several of them name an operator and an address that
do not exist yet, and one of them describes a safe harbour that does not attach
until a form is filed.

Nothing here is legal advice. These documents have not been reviewed by a
lawyer.

## Before launch

- [ ] **Register the entity.** The Terms pick Delaware law; a Delaware entity is
      not required for that to hold, but "who is the operator" is currently
      answered by the string `Draft Nova` in `js/legal/config.js`. Once a company
      exists, set `OPERATOR_LEGAL_NAME` to its registered name.
- [ ] **Buy the domain and stand up addresses.** `CONTACT_EMAIL`,
      `PRIVACY_EMAIL` and `DMCA_EMAIL` all currently point at
      `maxwell@gurrbrothers.com`. That is a real, reachable channel — which is
      what the law asks for — but it is a personal address doing the work of
      `legal@`, `privacy@` and `dmca@`.
- [ ] **Set `SITE_URL`** to the production domain rather than the github.io
      fallback.
- [ ] **Register the DMCA agent** with the US Copyright Office
      (dmca.copyright.gov, $6, renewable every three years). `legal/dmca.html`
      describes the notice-and-takedown process correctly, but §512 safe harbour
      does not attach until the agent is registered. This is the single
      cheapest piece of real protection on this list.
- [ ] **Have a lawyer read the Terms and the Privacy Policy**, and pay
      particular attention to §14 (limitation of liability) and §16
      (arbitration and class-action waiver). Enforceability there is
      fact-specific and varies by state.
- [ ] **Check the Supabase project's data-processing terms** are accepted, since
      the Privacy Policy names Supabase as a processor acting on our
      instructions.

## Before charging anyone money

Monetisation changes the analysis, not just the paperwork.

- [ ] Add payment terms, refund/cancellation policy, and the payment processor
      to the Privacy Policy's processor table.
- [ ] Re-check the player-name question with a lawyer. Using real athletes'
      names and statistics in a fantasy-style game has good precedent behind it
      (*CBC Distribution v. MLB Advanced Media*, 8th Cir. 2007; *Daniels v.
      FanDuel*, Ind. 2018), and Draft Nova uses no photographs, likenesses or
      logos — but a paid product is a harder case than a free one, and
      right-of-publicity law varies by state.
- [ ] Confirm nothing in the paid design looks like a wager: no entry fees
      against prize pools, no chance-based purchases with cash-out value. The
      Terms currently promise none of this exists.
- [ ] Review consumer-protection requirements for auto-renewing subscriptions
      (California's ARL in particular) if subscriptions are introduced.
- [ ] Sales tax / VAT on digital goods.

## Data sourcing

- [ ] `data/nba-players.js` is built from Basketball Reference season exports
      (see `tools/README.md`). Statistics themselves are facts and not
      copyrightable, but Sports Reference's terms restrict bulk extraction. The
      realistic downside is a cease-and-desist or an IP block rather than
      damages. A licensed or explicitly open source removes the question.
- [ ] `data/nfl-players.js` comes from nflverse, which is openly licensed.
      `legal/disclaimers.html` credits it; keep that credit accurate if the
      source changes.

## Operational, once there are players

- [ ] Watch the inbox for reports. Squad chat is switched off, so there is no
      in-app report button today and `legal/community.html` points people at
      email instead. `public.message_reports` and `report_squad_message()` are
      still in place for when chat returns; nothing notifies anyone when a row
      arrives.
- [ ] Before switching squad chat back on: restore the client (see
      `js/squads.js`), give the poll an incremental query rather than the
      last-fifty-every-four-seconds one it had, and update
      `legal/privacy.html`, `legal/community.html`, `legal/terms.html` and
      `legal/ai-disclosure.html` — all four currently say chat is off.
- [ ] Set a retention job for `message_reports`. The Privacy Policy says
      moderation records are kept up to 12 months; nothing currently deletes
      them.
- [ ] Keep `public.blocked_terms` current. It is a table, not code, so it can be
      updated from the Supabase SQL editor without a deploy.
- [ ] Answer privacy requests within 30 days — the window the Privacy Policy
      commits to. Deletion is self-serve in the app; export is not, and would be
      done by hand today.
- [ ] Re-run the false-positive check after adding terms:

      select name, public.moderation_blocked_category(name)
        from public.players
       where public.moderation_blocked_category(name) is not null;

      It returns zero rows today, across every NBA and NFL player name in the
      database. A new term that makes it return rows is blocking real surnames.

## When a document changes

`js/legal/config.js` holds `VERSION` and `LAST_UPDATED`, and every page renders
them through `[data-legal-updated]`. Bump both for a substantive change (not for
typos), and give notice in the game before a material change takes effect — the
Terms and the Privacy Policy both promise that.

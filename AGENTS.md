<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules
- All prediction/scheduling logic lives in pure modules under `src/lib/engine` (no React) so pages, scenarios and the backtest share one implementation and can be tested headless.
- Live fleet state comes from `FleetProvider` (src/lib/fleet-context.tsx) mounted in `__root`; pages read it via `useFleet()` rather than regenerating data.
- Metrics shown in the UI must be computed by the engine, never hardcoded (honesty requirement).

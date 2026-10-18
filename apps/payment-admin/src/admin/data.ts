// Static UI config + types still used by the layout/shared primitives.
// Live business data now flows through `./api/client.ts`.

// Used by MovementTimeline in shared.tsx and re-emitted by transaction detail.
export interface MovementEvent {
  time: string;
  action: string;
  from: string | null;
  to: string;
  actor: string;
  detail: string;
}

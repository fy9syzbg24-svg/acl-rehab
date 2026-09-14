// One place for "is my work safe": the header chip, on every device.
//
// Before, the phone's chip spoke only about the cloud (Local, a number, Synced)
// and never said whether a change had been saved on the phone itself, and the
// Mac said "saved" in one spot and synced in another. Codex's audit asked for
// one stable place (2026-09-14). The chip is always the same button in the same
// spot, tapping it syncs, and its words go, most urgent first:
//
//   Not saved   the save to this device failed (red)
//   Saving      a change is on its way to this device
//   Syncing     talking to the relay
//   Retry       the last sync failed; the work is safe on this device (red)
//   3 to sync   saved here, waiting to reach the other devices (amber)
//   Synced      saved here and everywhere (green)
//   Saved       sync not set up on this device: saved here (green)

export function chipState({ state, syncing, configured, pending, syncError, saveOutstanding }) {
  if (state.error && !state.readOnly) return { dot: 'err', label: 'Not saved', title: state.error };
  if (state.readOnly) return { dot: 'err', label: 'Read only', title: state.error || 'Cannot reach the server' };
  if (saveOutstanding) return { dot: 'busy', label: 'Saving', title: 'Saving on this device' };
  if (!configured) return { dot: 'ok', label: 'Saved', title: 'Saved on this device. Sync is not set up here.' };
  if (syncing) return { dot: 'busy', label: 'Syncing', title: 'Syncing with your other devices' };
  if (syncError) return { dot: 'err', label: 'Retry', title: 'The last sync failed. Everything is saved on this device.' };
  if (pending) return { dot: 'pending', label: `${pending} to sync`, title: 'Saved on this device, waiting to reach your other devices' };
  return { dot: 'ok', label: 'Synced', title: 'Saved on this device and synced' };
}

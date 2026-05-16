import { useQuery } from "@tanstack/react-query"

import {
  DEFAULT_STATE_MACHINE,
  fetchStateMachine,
  type StateMachineContract,
} from "@/api/documents"

/**
 * Loads the canonical document lifecycle contract once and caches it for the
 * session. Every status-aware piece of UI derives its behaviour from this so
 * web and mobile never disagree about the state machine again.
 *
 * Falls back to DEFAULT_STATE_MACHINE if the endpoint is unreachable so the
 * UI keeps polling correctly even during a transient backend hiccup.
 */
export function useStateMachine(): StateMachineContract {
  const { data } = useQuery({
    queryKey: ["state-machine"],
    queryFn: fetchStateMachine,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 2,
    placeholderData: DEFAULT_STATE_MACHINE,
  })
  return data ?? DEFAULT_STATE_MACHINE
}

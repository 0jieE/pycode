import { useParams } from 'react-router-dom'

/** A numeric route parameter, or null when it is missing or not a whole number (e.g. /classes/abc). */
export function useIdParam(name: string): number | null {
  const raw = useParams()[name]
  if (!raw || !/^\d+$/.test(raw)) return null
  return Number(raw)
}

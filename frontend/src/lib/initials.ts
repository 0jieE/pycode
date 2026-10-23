/** "Student 01" -> "S0", "Juan Dela Cruz" -> "JD": an account's badge. */
export function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')
}

export function greetingPrefix(): "Good morning" | "Good afternoon" | "Good evening" {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}

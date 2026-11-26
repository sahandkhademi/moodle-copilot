// Matches Moodle Timeline links to our deadlines: both point at /mod/<type>/view.php?id=<cmid>.
export function activityKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/mod\/(\w+)\/view\.php\?(?:[^#]*&)?id=(\d+)/);
  return m ? `${m[1]}:${m[2]}` : null;
}

/** Thrown when the student is not logged in to Moodle (or the session expired). */
export class MoodleAuthError extends Error {
  constructor(message = 'Bitte in Moodle einloggen') {
    super(message);
    this.name = 'MoodleAuthError';
  }
}

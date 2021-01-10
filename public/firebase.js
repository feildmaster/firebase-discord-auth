if (!window.firebase) throw new Error('firebase not loaded');

export function projectId() {
  return firebase.app().options.projectId;
}

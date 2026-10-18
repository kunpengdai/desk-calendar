const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('desk', {
  state: () => invoke('state'),
  events: (timeMin, timeMax) => invoke('events', timeMin, timeMax),
  tasks: (timeMin, timeMax) => invoke('tasks', timeMin, timeMax),
  cached: (timeMin, timeMax) => invoke('cache', timeMin, timeMax),
  syncNow: () => invoke('sync-now'),
  debugOffline: offline => invoke('debug:offline', offline),
  onDataChanged: fn => ipcRenderer.on('data-changed', () => fn()),
  setTaskDone: (listId, taskId, done) => invoke('task:set-done', listId, taskId, done),
  taskLists: () => invoke('task:lists'),
  createTask: task => invoke('task:create', task),
  rescheduleTask: (listId, taskId, input) => invoke('task:reschedule', listId, taskId, input),
  deleteTask: (listId, taskId) => invoke('task:delete', listId, taskId),
  writableCalendars: () => invoke('calendars:writable'),
  createEvent: (calendarId, input) => invoke('event:create', calendarId, input),
  updateEvent: (calendarId, eventId, input) => invoke('event:update', calendarId, eventId, input),
  deleteEvent: (calendarId, eventId) => invoke('event:delete', calendarId, eventId),
  importClient: () => invoke('auth:import'),
  connect: () => invoke('auth:connect'),
  cancelConnect: () => invoke('auth:cancel'),
  disconnect: () => invoke('auth:disconnect'),
  setPrefs: value => invoke('prefs', value),
  open: url => invoke('open', url),
  hide: () => invoke('window:hide'),
  fitWidth: width => invoke('window:fit-width', width),
  onStateChanged: fn => ipcRenderer.on('state-changed', () => fn()),
  onRefresh: fn => ipcRenderer.on('refresh', () => fn()),
});

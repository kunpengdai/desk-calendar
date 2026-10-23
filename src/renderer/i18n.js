// 中英文文案。主进程（require）和界面（window.I18N）共用。
// t('key', { name: value }) 用 {name} 插值；英文中 n === 1 时优先使用 key + '.one'。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.I18N = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MESSAGES = {
    zh: {
      // 标题栏 / 工具栏
      'btn.refresh': '刷新', 'btn.pin': '窗口置顶', 'btn.settings': '设置', 'btn.hide': '收起到托盘',
      'view.group': '视图', 'view.month': '月', 'view.week': '周', 'view.day': '日',
      'btn.newEvent': '新建日程', 'btn.today': '今天',
      'nav.prev': '上一个', 'nav.next': '下一个',
      'nav.prevMonth': '上个月', 'nav.nextMonth': '下个月', 'nav.prevWeek': '上一周', 'nav.nextWeek': '下一周', 'nav.prevDay': '前一天', 'nav.nextDay': '后一天',
      // 欢迎页
      'welcome.title': '把 Google 日历放到桌面', 'welcome.text': '登录后即可在这里查看日程和 Google Tasks。', 'welcome.start': '开始设置',
      // 任务面板
      'tasks.filter': '任务筛选', 'tasks.all': '全部', 'tasks.todayOverdue': '今天及逾期', 'tasks.selected': '所选日期',
      'tasks.selectedToday': '所选日期（今天）', 'tasks.selectedDate': '所选日期（{date}）',
      'tasks.emptyDay': '这一天没有任务', 'tasks.emptyFilter': '这里没有待办', 'tasks.allDone': '所有任务都完成了 🎉',
      'tasks.hasNotes': ' · 有备注', 'tasks.done': '已完成', 'tasks.delete': '删除任务', 'tasks.deleteAria': '删除任务：{title}', 'tasks.confirmShort': '删除?',
      'tasks.markDone': '标记完成', 'tasks.reopen': '恢复为未完成', 'tasks.checkAria': '{action}：{title}',
      'nt.placeholder': '新建任务，回车添加', 'nt.name': '任务名称', 'nt.add': '添加', 'nt.due': '截止日期', 'nt.time': '完成时间（可选）', 'nt.list': '任务列表',
      // 底栏
      'footer.openTitle': '在浏览器打开 Google 日历', 'footer.open': '打开 Google 日历 ↗',
      // 设置
      'settings.title': '设置', 'close': '关闭', 'settings.account': 'Google 账号',
      'setup.s1a': '打开 ', 'setup.cloudConsole': 'Google Cloud 控制台', 'setup.s1b': '，新建一个项目。',
      'setup.s2a': '在 API 库中启用 ', 'setup.s2and': ' 和 ', 'setup.s2b': '。',
      'setup.s3a': '在 ', 'setup.s3b': ' 填写应用名称，受众选“外部”，并把自己的 Gmail 加为测试用户。',
      'setup.s4': '在“客户端”中创建 OAuth 客户端，类型选“桌面应用”，下载 JSON 文件。',
      'setup.s5': '点击下方“导入客户端 JSON”，再点“登录 Google”。',
      'btn.import': '导入客户端 JSON', 'btn.importChange': '更换客户端 JSON', 'btn.connect': '登录 Google', 'btn.cancel': '取消', 'btn.disconnect': '退出登录',
      'settings.window': '窗口', 'pref.pinned': '窗口置顶', 'pref.pinnedHint': '始终显示在其他窗口上方',
      'pref.autostart': '开机启动', 'pref.autostartHint': '登录 Windows 时自动打开', 'pref.opacity': '不透明度',
      'pref.language': '语言', 'lang.auto': '跟随系统',
      'settings.footer': '可以新建、编辑、删除和拖动日程；任务可以勾选完成。每 5 分钟自动同步。登录信息使用 Windows 加密保存在本机。',
      // 详情
      'detail.edit': '编辑', 'detail.open': '在 Google 中打开 ↗', 'detail.complete': '标记完成', 'detail.reopen': '恢复为未完成',
      'detail.delete': '删除', 'detail.confirmDelete': '确认删除？',
      'kind.event': '日程', 'kind.task': '任务', 'kind.taskDone': '任务 · 已完成',
      'detail.due': '截止：{date}', 'detail.noDue': '未设置截止日期', 'detail.completedAt': '✓ 完成于 {date}', 'detail.completed': '✓ 已完成', 'detail.allDay': '全天',
      'note.readOnly': '只读日历，不能修改。', 'note.needScope': '要编辑日程，请在设置中退出并重新登录 Google，授予编辑权限。',
      'note.recurring': '这是重复日程中的一次，编辑或删除只影响这一次。',
      // 日程编辑
      'editor.new': '新建日程', 'editor.edit': '编辑日程', 'editor.noWritable': '没有可以写入的日历。',
      'ev.titlePh': '添加标题', 'ev.title': '标题', 'ev.allDay': '全天', 'ev.start': '开始', 'ev.startDate': '开始日期', 'ev.startTime': '开始时间',
      'ev.end': '结束', 'ev.endDate': '结束日期', 'ev.endTime': '结束时间', 'ev.calendar': '日历',
      'ev.locationPh': '地点（可选）', 'ev.location': '地点', 'ev.descriptionPh': '说明（可选）', 'ev.description': '说明',
      'ev.recurring': '这是重复日程中的一次，修改只影响这一次。', 'btn.save': '保存',
      // 日历内容
      'time.allDay': '全天', 'time.prevDay': '前日', 'time.nextDay': '次日', 'live': '进行中',
      'due.none': '无日期', 'due.overdue': '逾期 · {date}', 'due.today': '今天', 'due.tomorrow': '明天',
      'agenda.today': '今天', 'agenda.events': '{n} 项日程', 'agenda.tasksDone': '任务 {done}/{total} 完成', 'agenda.empty': '这一天没有日程', 'agenda.task': '任务',
      'week.openDay': '{date}，打开日视图',
      // 状态栏
      'status.demoPrefix': '示例模式 · ', 'status.authorizing': '请在浏览器中完成 Google 登录…',
      'status.offline': '⚡ 离线 · 显示本地缓存', 'status.offlinePending': ' · {n} 项修改待同步', 'status.syncing': '⟳ 正在同步 {n} 项修改…',
      'status.demo': '示例模式 · 非真实数据', 'status.signedOut': '未登录 Google', 'status.signedIn': '已登录', 'status.synced': ' · 同步于 {time}',
      'account.demo': '示例模式不会连接真实账号。', 'account.signedIn': '已登录：{account}', 'account.googleAccount': 'Google 账号',
      'account.hasClient': '已导入客户端，点击“登录 Google”。', 'account.setup': '尚未设置。按以下步骤创建你自己的 OAuth 客户端（约 5 分钟）：',
      // 提示
      'err.generic': '操作失败', 'toast.signedIn': '已登录 Google', 'toast.taskAdded': '已添加：{title}', 'toast.taskDeleted': '已删除任务：{title}',
      'toast.taskDone': '已完成：{title}', 'toast.taskReopened': '已恢复为未完成：{title}',
      'toast.eventSaved': '已保存：{title}', 'toast.eventAdded': '已添加日程：{title}', 'toast.eventDeleted': '已删除：{title}',
      // 错误
      'err.titleRequired': '请输入标题。', 'err.dateRequired': '请选择日期。', 'err.endDateBeforeStart': '结束日期不能早于开始日期。',
      'err.endAfterStart': '结束时间必须晚于开始时间。', 'err.noEncryption': '系统加密不可用，无法安全保存登录信息。',
      'err.eventInvalid': '日程无效。', 'err.eventTitle': '请输入日程标题。', 'err.titleTooLong': '标题太长。', 'err.contentInvalid': '内容无效。',
      'err.dateInvalid': '日期无效。', 'err.timeInvalid': '时间无效。', 'err.taskInvalid': '任务无效。', 'err.taskTitle': '请输入任务名称。',
      'err.taskTitleTooLong': '任务名称太长。', 'err.demoNoLogin': '示例模式不能登录，请用 npm start 正常启动。', 'err.importFirst': '请先导入 OAuth 客户端 JSON 文件。',
      'err.prefsInvalid': '设置无效。', 'err.linkBlocked': '不支持打开这个链接。', 'err.rangeInvalid': '时间范围无效。',
      'err.network': '无法连接 Google，请检查网络。', 'err.unavailable': 'Google 服务暂时不可用（{status}），稍后重试。',
      'err.badJson': '不是有效的 JSON 文件。', 'err.webClient': '这是“网页应用”凭据，请在 Google Cloud 创建“桌面应用”类型的 OAuth 客户端。',
      'err.noDesktopClient': '文件中没有找到桌面应用的 client_id / client_secret。',
      'err.authCancelled': '已取消授权。', 'err.authTimeout': '授权超时，请重试。', 'err.authState': '授权状态校验失败，请重试。',
      'err.accessDenied': '授权被拒绝。如果 Google 提示“应用正在测试中”，请在 Google Auth Platform →“目标对象”中把你的 Gmail 加为测试用户，或点击“发布应用”。',
      'err.authFailed': '授权失败：{error}', 'auth.noCode': '没有授权码',
      'err.noRefresh': 'Google 没有返回刷新令牌，请在 Google 账号权限中移除本应用后重新授权。', 'err.authExpired': 'Google 授权已过期或被撤销，请重新登录。',
      'err.tokenFailed': '获取令牌失败：{error}', 'err.apiDisabled': 'Google Cloud 项目中尚未启用 Calendar API 或 Tasks API。',
      'err.needScope': '需要重新登录 Google 以授予编辑日程的权限：设置 → 退出登录 → 登录 Google。', 'err.readOnly': '没有修改这个日历的权限（只读日历）。',
      'err.api': 'Google 接口错误（{status}）：{message}', 'err.noTaskList': '没有可用的任务列表。', 'err.eventNotFound': '日程不存在。',
      'err.cacheSave': '无法保存本地缓存：{message}', 'err.notSignedIn': '尚未登录 Google。', 'err.unknownOp': '未知操作：{type}',
      'err.syncDropped': '一项离线修改无法同步，已放弃：{message}',
      'untitled.event': '（无标题）', 'untitled.task': '（无标题任务）',
      // 授权回调页
      'auth.success': '授权成功 ✓', 'auth.stateFailed': '授权校验失败', 'auth.notCompleted': '授权未完成', 'auth.close': '现在可以关闭此页面，回到桌面日历。',
      // 主进程
      'dialog.chooseClient': '选择 Google OAuth 客户端 JSON（桌面应用）',
      'tray.show': '显示日历', 'tray.refresh': '立即刷新', 'tray.pin': '窗口置顶', 'tray.autostart': '开机启动', 'tray.quit': '退出', 'tray.tooltip': 'DeskCalendar · Google 日历',
      // 示例数据
      'demo.calendar': '我的日历', 'demo.work': '工作', 'demo.holidays': '中国节假日', 'demo.descEvent': '示例日程', 'demo.descAllDay': '示例全天日程',
      'demo.standup': '晨会', 'demo.roomA': '会议室 A', 'demo.review': '产品评审', 'demo.online': '线上', 'demo.designSync': '和设计同步', 'demo.lunch': '午餐',
      'demo.weekly': '写周报', 'demo.gym': '健身', 'demo.gymPlace': '健身房', 'demo.clientCall': '客户电话', 'demo.dentist': '牙医', 'demo.bookClub': '读书会',
      'demo.trip': '出差 · 上海', 'demo.momBirthday': '妈妈生日', 'demo.release': '版本发布日', 'demo.sprint': '个人项目冲刺 · 第 1–2 周', 'demo.holiday': '重阳节',
      'demo.list.work': '工作', 'demo.list.life': '生活', 'demo.list.personal': '个人',
      'demo.t1': '提交报销单', 'demo.t1notes': '附上发票照片', 'demo.t2': '确认发布清单', 'demo.t3': '买牛奶和鸡蛋', 'demo.t4': '预订机票',
      'demo.t5': '整理读书笔记', 'demo.t6': '晨跑 5 公里', 'demo.t7': '回复客户邮件', 'demo.t8': '交水电费',
      'demo.coffee': '和朋友喝咖啡', 'demo.cafe': '街角咖啡馆',
    },
    en: {
      'btn.refresh': 'Refresh', 'btn.pin': 'Keep on top', 'btn.settings': 'Settings', 'btn.hide': 'Hide to tray',
      'view.group': 'View', 'view.month': 'Month', 'view.week': 'Week', 'view.day': 'Day',
      'btn.newEvent': 'New event', 'btn.today': 'Today',
      'nav.prev': 'Previous', 'nav.next': 'Next',
      'nav.prevMonth': 'Previous month', 'nav.nextMonth': 'Next month', 'nav.prevWeek': 'Previous week', 'nav.nextWeek': 'Next week', 'nav.prevDay': 'Previous day', 'nav.nextDay': 'Next day',
      'welcome.title': 'Google Calendar on your desktop', 'welcome.text': 'Sign in to see your events and Google Tasks here.', 'welcome.start': 'Get started',
      'tasks.filter': 'Task filter', 'tasks.all': 'All', 'tasks.todayOverdue': 'Today & overdue', 'tasks.selected': 'Selected day',
      'tasks.selectedToday': 'Selected day (today)', 'tasks.selectedDate': 'Selected day ({date})',
      'tasks.emptyDay': 'No tasks on this day', 'tasks.emptyFilter': 'Nothing to do here', 'tasks.allDone': 'All tasks done 🎉',
      'tasks.hasNotes': ' · has notes', 'tasks.done': 'Done', 'tasks.delete': 'Delete task', 'tasks.deleteAria': 'Delete task: {title}', 'tasks.confirmShort': 'Delete?',
      'tasks.markDone': 'Mark complete', 'tasks.reopen': 'Mark incomplete', 'tasks.checkAria': '{action}: {title}',
      'nt.placeholder': 'New task, press Enter to add', 'nt.name': 'Task name', 'nt.add': 'Add', 'nt.due': 'Due date', 'nt.time': 'Time (optional)', 'nt.list': 'Task list',
      'footer.openTitle': 'Open Google Calendar in your browser', 'footer.open': 'Open Google Calendar ↗',
      'settings.title': 'Settings', 'close': 'Close', 'settings.account': 'Google account',
      'setup.s1a': 'Open ', 'setup.cloudConsole': 'the Google Cloud console', 'setup.s1b': ' and create a project.',
      'setup.s2a': 'In the API Library, enable ', 'setup.s2and': ' and ', 'setup.s2b': '.',
      'setup.s3a': 'In ', 'setup.s3b': ', fill in an app name, choose the "External" audience, and add your Gmail as a test user.',
      'setup.s4': 'Under "Clients", create an OAuth client of type "Desktop app" and download its JSON file.',
      'setup.s5': 'Click "Import client JSON" below, then "Sign in with Google".',
      'btn.import': 'Import client JSON', 'btn.importChange': 'Replace client JSON', 'btn.connect': 'Sign in with Google', 'btn.cancel': 'Cancel', 'btn.disconnect': 'Sign out',
      'settings.window': 'Window', 'pref.pinned': 'Keep on top', 'pref.pinnedHint': 'Always stay above other windows',
      'pref.autostart': 'Start with Windows', 'pref.autostartHint': 'Open automatically when you sign in to Windows', 'pref.opacity': 'Opacity',
      'pref.language': 'Language', 'lang.auto': 'System default',
      'settings.footer': 'Create, edit, delete and drag events; check off tasks. Syncs every 5 minutes. Sign-in data is encrypted with Windows and stays on this PC.',
      'detail.edit': 'Edit', 'detail.open': 'Open in Google ↗', 'detail.complete': 'Mark complete', 'detail.reopen': 'Mark incomplete',
      'detail.delete': 'Delete', 'detail.confirmDelete': 'Confirm delete?',
      'kind.event': 'Event', 'kind.task': 'Task', 'kind.taskDone': 'Task · done',
      'detail.due': 'Due {date}', 'detail.noDue': 'No due date', 'detail.completedAt': '✓ Completed {date}', 'detail.completed': '✓ Completed', 'detail.allDay': 'all day',
      'note.readOnly': 'Read-only calendar; it can’t be changed.', 'note.needScope': 'To edit events, sign out in Settings and sign in to Google again to grant edit access.',
      'note.recurring': 'This is one occurrence of a recurring event; edits and deletion apply to this occurrence only.',
      'editor.new': 'New event', 'editor.edit': 'Edit event', 'editor.noWritable': 'There’s no calendar you can write to.',
      'ev.titlePh': 'Add title', 'ev.title': 'Title', 'ev.allDay': 'All day', 'ev.start': 'Start', 'ev.startDate': 'Start date', 'ev.startTime': 'Start time',
      'ev.end': 'End', 'ev.endDate': 'End date', 'ev.endTime': 'End time', 'ev.calendar': 'Calendar',
      'ev.locationPh': 'Location (optional)', 'ev.location': 'Location', 'ev.descriptionPh': 'Description (optional)', 'ev.description': 'Description',
      'ev.recurring': 'This is one occurrence of a recurring event; changes apply to this occurrence only.', 'btn.save': 'Save',
      'time.allDay': 'All day', 'time.prevDay': 'prev. day', 'time.nextDay': 'next day', 'live': 'Now',
      'due.none': 'No date', 'due.overdue': 'Overdue · {date}', 'due.today': 'Today', 'due.tomorrow': 'Tomorrow',
      'agenda.today': 'Today', 'agenda.events': '{n} events', 'agenda.events.one': '1 event', 'agenda.tasksDone': 'Tasks {done}/{total} done', 'agenda.empty': 'Nothing scheduled', 'agenda.task': 'Task',
      'week.openDay': '{date}, open day view',
      'status.demoPrefix': 'Demo · ', 'status.authorizing': 'Finish signing in to Google in your browser…',
      'status.offline': '⚡ Offline · showing cache', 'status.offlinePending': ' · {n} pending', 'status.offlinePending.one': ' · 1 pending',
      'status.syncing': '⟳ Syncing {n} changes…', 'status.syncing.one': '⟳ Syncing 1 change…',
      'status.demo': 'Demo mode · sample data', 'status.signedOut': 'Not signed in to Google', 'status.signedIn': 'Signed in', 'status.synced': ' · synced {time}',
      'account.demo': 'Demo mode doesn’t connect to a real account.', 'account.signedIn': 'Signed in as {account}', 'account.googleAccount': 'Google account',
      'account.hasClient': 'Client imported. Click "Sign in with Google".', 'account.setup': 'Not set up yet. Create your own OAuth client (about 5 minutes):',
      'err.generic': 'Something went wrong', 'toast.signedIn': 'Signed in to Google', 'toast.taskAdded': 'Added: {title}', 'toast.taskDeleted': 'Task deleted: {title}',
      'toast.taskDone': 'Completed: {title}', 'toast.taskReopened': 'Marked incomplete: {title}',
      'toast.eventSaved': 'Saved: {title}', 'toast.eventAdded': 'Event added: {title}', 'toast.eventDeleted': 'Deleted: {title}',
      'err.titleRequired': 'Please enter a title.', 'err.dateRequired': 'Please choose a date.', 'err.endDateBeforeStart': 'The end date can’t be before the start date.',
      'err.endAfterStart': 'The end time must be after the start time.', 'err.noEncryption': 'System encryption is unavailable, so sign-in data can’t be stored securely.',
      'err.eventInvalid': 'Invalid event.', 'err.eventTitle': 'Please enter an event title.', 'err.titleTooLong': 'The title is too long.', 'err.contentInvalid': 'Invalid content.',
      'err.dateInvalid': 'Invalid date.', 'err.timeInvalid': 'Invalid time.', 'err.taskInvalid': 'Invalid task.', 'err.taskTitle': 'Please enter a task name.',
      'err.taskTitleTooLong': 'The task name is too long.', 'err.demoNoLogin': 'Sign-in isn’t available in demo mode. Start the app normally with npm start.', 'err.importFirst': 'Import the OAuth client JSON file first.',
      'err.prefsInvalid': 'Invalid settings.', 'err.linkBlocked': 'This link can’t be opened.', 'err.rangeInvalid': 'Invalid time range.',
      'err.network': 'Can’t reach Google. Check your network connection.', 'err.unavailable': 'Google is temporarily unavailable ({status}); will retry later.',
      'err.badJson': 'Not a valid JSON file.', 'err.webClient': 'These are "Web application" credentials. Create an OAuth client of type "Desktop app" in Google Cloud.',
      'err.noDesktopClient': 'No Desktop-app client_id / client_secret found in the file.',
      'err.authCancelled': 'Sign-in cancelled.', 'err.authTimeout': 'Sign-in timed out. Please try again.', 'err.authState': 'Sign-in verification failed. Please try again.',
      'err.accessDenied': 'Access denied. If Google says the app is "being tested", add your Gmail as a test user under Google Auth Platform → Audience, or click "Publish app".',
      'err.authFailed': 'Sign-in failed: {error}', 'auth.noCode': 'no authorization code',
      'err.noRefresh': 'Google didn’t return a refresh token. Remove this app in your Google Account’s third-party access settings and sign in again.', 'err.authExpired': 'Google sign-in expired or was revoked. Please sign in again.',
      'err.tokenFailed': 'Couldn’t get a token: {error}', 'err.apiDisabled': 'The Calendar API or Tasks API isn’t enabled in your Google Cloud project.',
      'err.needScope': 'Sign in to Google again to grant permission to edit events: Settings → Sign out → Sign in with Google.', 'err.readOnly': 'You don’t have permission to change this calendar (read-only).',
      'err.api': 'Google API error ({status}): {message}', 'err.noTaskList': 'No task list available.', 'err.eventNotFound': 'Event not found.',
      'err.cacheSave': 'Couldn’t save the local cache: {message}', 'err.notSignedIn': 'Not signed in to Google.', 'err.unknownOp': 'Unknown operation: {type}',
      'err.syncDropped': 'An offline change couldn’t be synced and was discarded: {message}',
      'untitled.event': '(No title)', 'untitled.task': '(Untitled task)',
      'auth.success': 'Signed in ✓', 'auth.stateFailed': 'Verification failed', 'auth.notCompleted': 'Sign-in not completed', 'auth.close': 'You can close this page and return to DeskCalendar.',
      'dialog.chooseClient': 'Choose the Google OAuth client JSON (Desktop app)',
      'tray.show': 'Show calendar', 'tray.refresh': 'Refresh now', 'tray.pin': 'Keep on top', 'tray.autostart': 'Start with Windows', 'tray.quit': 'Quit', 'tray.tooltip': 'DeskCalendar · Google Calendar',
      'demo.calendar': 'My calendar', 'demo.work': 'Work', 'demo.holidays': 'Holidays', 'demo.descEvent': 'Sample event', 'demo.descAllDay': 'Sample all-day event',
      'demo.standup': 'Standup', 'demo.roomA': 'Room A', 'demo.review': 'Product review', 'demo.online': 'Online', 'demo.designSync': 'Design sync', 'demo.lunch': 'Lunch',
      'demo.weekly': 'Weekly report', 'demo.gym': 'Gym', 'demo.gymPlace': 'Fitness center', 'demo.clientCall': 'Client call', 'demo.dentist': 'Dentist', 'demo.bookClub': 'Book club',
      'demo.trip': 'Trip · Shanghai', 'demo.momBirthday': 'Mom’s birthday', 'demo.release': 'Release day', 'demo.sprint': 'Side project sprint · weeks 1–2', 'demo.holiday': 'Double Ninth Festival',
      'demo.list.work': 'Work', 'demo.list.life': 'Home', 'demo.list.personal': 'Personal',
      'demo.t1': 'Submit expense report', 'demo.t1notes': 'Attach photos of the receipts', 'demo.t2': 'Confirm release checklist', 'demo.t3': 'Buy milk and eggs', 'demo.t4': 'Book flights',
      'demo.t5': 'Organize reading notes', 'demo.t6': 'Morning run 5 km', 'demo.t7': 'Reply to client email', 'demo.t8': 'Pay utility bills',
      'demo.coffee': 'Coffee with friends', 'demo.cafe': 'Corner café',
    },
  };

  let current = 'zh';
  const LOCALES = { zh: 'zh-CN', en: 'en-US' };

  // 偏好 'auto' 时按系统语言：中文系统用中文，其他用英文
  function resolveLang(pref, systemLocale) {
    if (pref === 'zh' || pref === 'en') return pref;
    return /^zh/i.test(systemLocale || '') ? 'zh' : 'en';
  }
  function setLang(lang) { current = MESSAGES[lang] ? lang : 'zh'; }
  const getLang = () => current;
  const locale = () => LOCALES[current];

  function t(key, params = {}) {
    const dict = MESSAGES[current];
    let text = (params.n === 1 && dict[`${key}.one`]) || dict[key] || MESSAGES.zh[key] || key;
    for (const [name, value] of Object.entries(params)) text = text.split(`{${name}}`).join(String(value));
    return text;
  }

  // 界面：data-i18n（文字）、data-i18n-title、data-i18n-placeholder、data-i18n-aria
  function applyDom(root) {
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    if (root.documentElement) root.documentElement.lang = LOCALES[current];
  }

  return { MESSAGES, t, setLang, getLang, locale, resolveLang, applyDom };
});

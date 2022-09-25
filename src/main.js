const {
  app,
  shell,
  dialog,
  ipcMain,
  nativeImage,
  BrowserWindow,
  Menu
} = require('electron')
const {resolve, join, slice, dirname} = require('path')
const i18n = require('./i18n')
const setting = require('./setting')
const updater = require('./updater')
require('@electron/remote/main').initialize()
const Database = require('better-sqlite3')
const {readdirSync} = require('fs')

let windows = []
let openfile = null

function newWindow(path) {
  let window = new BrowserWindow({
    icon: nativeImage.createFromPath(resolve(__dirname, '../logo.png')),
    title: app.name,
    useContentSize: true,
    width: setting.get('window.width'),
    height: setting.get('window.height'),
    minWidth: setting.get('window.minwidth'),
    minHeight: setting.get('window.minheight'),
    autoHideMenuBar: !setting.get('view.show_menubar'),
    backgroundColor: '#111111',
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      zoomFactor: setting.get('app.zoom_factor')
    }
  })

  windows.push(window)
  buildMenu()

  window.once('ready-to-show', () => {
    window.show()
  })

  if (setting.get('window.maximized') === true) {
    window.maximize()
  }

  // store the window size
  window.on('maximize', () => {
    setting.set('window.maximized', true)
  })

  window.on('unmaximize', () => {
    setting.set('window.maximized', false)
  })

  window.on('closed', () => {
    window = null
  })

  window.webContents.audioMuted = !setting.get('sound.enable')

  window.webContents.on('did-finish-load', () => {
    if (path) window.webContents.send('load-file', path)
  })

  window.webContents.setWindowOpenHandler(({url, frameName}) => {
    return {action: 'deny'}
  })

  window.loadURL(`file://${resolve(__dirname, '../index.html')}`)

  return window
}

function buildMenu(props = {}) {
  let template = require('./menu').get(props)

  // Process menu items

  let processMenu = items => {
    return items.map(item => {
      if ('click' in item) {
        item.click = () => {
          let window = BrowserWindow.getFocusedWindow()
          if (!window) return

          window.webContents.send(`menu-click-${item.id}`)
        }
      }

      if ('clickMain' in item) {
        let key = item.clickMain

        item.click = () =>
          ({
            newWindow,
            checkForUpdates: () => checkForUpdates({showFailDialogs: true})
          }[key]())

        delete item.clickMain
      }

      if ('submenu' in item) {
        processMenu(item.submenu)
      }

      return item
    })
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(processMenu(template)))

  // Create dock menu

  let dockMenu = Menu.buildFromTemplate([
    {
      label: i18n.t('menu.file', 'New &Window'),
      click: () => newWindow()
    }
  ])

  if (process.platform === 'darwin') {
    app.dock.setMenu(dockMenu)
  }
}

async function checkForUpdates({showFailDialogs = false} = {}) {
  try {
    let t = i18n.context('updater')
    let info = await updater.check(`SabakiHQ/${app.name}`)

    if (info.hasUpdates) {
      dialog.showMessageBox(
        {
          type: 'info',
          buttons: [t('Download Update'), t('View Changelog'), t('Not Now')],
          title: app.name,
          message: t(p => `${p.appName} v${p.version} is available now.`, {
            appName: app.name,
            version: info.latestVersion
          }),
          noLink: true,
          cancelId: 2
        },
        response => {
          if (response === 2) return

          shell.openExternal(
            response === 0 ? info.downloadUrl || info.url : info.url
          )
        }
      )
    } else if (showFailDialogs) {
      dialog.showMessageBox(
        {
          type: 'info',
          buttons: [t('OK')],
          title: t('No updates available'),
          message: t(p => `${p.appName} v${p.version} is the latest version.`, {
            appName: app.name,
            version: app.getVersion()
          })
        },
        () => {}
      )
    }
  } catch (err) {
    if (showFailDialogs) {
      dialog.showMessageBox({
        type: 'warning',
        buttons: [t('OK')],
        title: app.name,
        message: t('An error occurred while checking for updates.')
      })
    }
  }
}

let db = undefined
let stmt_get_date = undefined
let stmt_get_q = undefined
let stmt_update = undefined
let problem = undefined
let problems_root = undefined
let problems_file = undefined
let problems_stat = undefined
let stmt_stat = undefined
let problems = []

function date2string(date) {
  return (
    date.getFullYear() +
    '-' +
    ('0' + (date.getMonth() + 1)).slice(-2) +
    '-' +
    ('0' + date.getDate()).slice(-2)
  )
}

function memoInitDB() {
  try {
    if (!db) {
      problems_file = setting.get('memo.db')
      problems_root = dirname(problems_file)

      db = new Database(problems_file)
      db = new Database('memo.db')

      db.exec(`CREATE TABLE IF NOT EXISTS problems (
    id TEXT PRIMARY KEY,
    rd TEXT DEFAULT CURRENT_DATE,
    ef REAL DEFAULT 2.5,
    i  INT DEFAULT 0,
    n  INT DEFAULT 0,
    q  INT DEFAULT 0
  ) WITHOUT ROWID`)

      db.exec(`CREATE TABLE IF NOT EXISTS stats (
    rd   TEXT PRIMARY KEY,
    m0   INT DEFAULT 0,
    m1   INT DEFAULT 0,
    m2   INT DEFAULT 0,
    m3   INT DEFAULT 0,
    m4   INT DEFAULT 0,
    m5   INT DEFAULT 0,
    done INT DEFAULT 0
  ) WITHOUT ROWID`)

      db.prepare('INSERT OR IGNORE INTO stats(rd) VALUES (?)').run(
        date2string(new Date())
      )

      problems_stat = db
        .prepare('SELECT * FROM stats WHERE rd = ?')
        .bind(date2string(new Date()))
        .get()

      stmt_get_date = db
        .prepare('SELECT * FROM problems WHERE rd <= ?')
        .bind(date2string(new Date()))

      stmt_get_q = db.prepare('SELECT * FROM problems WHERE q < ?')

      stmt_update = db.prepare(
        'UPDATE problems SET rd = ?, ef = ?, i = ?, n = ?, q = ? WHERE id = ?'
      )
    }
  } catch (e) {
    console.log(e)
    db = undefined
    problems_file = undefined
  }
}

function memoCloseDB() {
  if (db) {
    //    upadteStats()
    db.exec('VACUUM')
    db.close()
    db = undefined
    problems_file = undefined
  }
}

function upadteStats() {
  stmt_stat = db.prepare('SELECT COUNT(*) FROM problems WHERE q = ?')

  problems_stat.m0 = stmt_stat.get(0)['COUNT(*)']
  problems_stat.m1 = stmt_stat.get(1)['COUNT(*)']
  problems_stat.m2 = stmt_stat.get(2)['COUNT(*)']
  problems_stat.m3 = stmt_stat.get(3)['COUNT(*)']
  problems_stat.m4 = stmt_stat.get(4)['COUNT(*)']
  problems_stat.m5 = stmt_stat.get(5)['COUNT(*)']

  console.log(problems_stat)

  db.prepare(
    'UPDATE stats SET m0 = ?, m1 = ?, m2 = ?, m3 = ?, m4 = ?, m5 = ?, done = ? WHERE rd = ?'
  ).run(
    problems_stat.m0,
    problems_stat.m1,
    problems_stat.m2,
    problems_stat.m3,
    problems_stat.m4,
    problems_stat.m5,
    problems_stat.done,
    problems_stat.rd
  )
}

/*
Description of SM-2 algorithm

The first computer-based SuperMemo algorithm (SM-2)[8] tracks three properties
for each card being studied:

- The repetition number n, which is the number of times the card has been
  successfully recalled (meaning it was given a grade ≥ 3) in a row since
  the last time it was not.

- The easiness factor EF, which loosely indicates how "easy" the card is (more
  precisely, it determines how quickly the inter-repetition interval grows).
  The initial value of EF is 2.5.

- The inter-repetition interval I, which is the length of time (in days)
  SuperMemo will wait after the previous review before asking the user to review
  the card again.

Every time the user starts a review session, SuperMemo provides the user with
the cards whose last review occurred at least I days ago. For each review,
the user tries to recall the information and (after being shown the correct
answer) specifies a grade q (from 0 to 5) indicating a self-evaluation the
quality of their response, with each grade having the following meaning:

0: "Total blackout", complete failure to recall the information.
1: Incorrect response, but upon seeing the correct answer it felt familiar.
2: Incorrect response, but upon seeing the correct answer it seemed easy to remember.
3: Correct response, but required significant difficulty to recall.
4: Correct response, after some hesitation.
5: Correct response with perfect recall.

The following algorithm is then applied to update the three variables associated with the card:

//////////////////////////////

algorithm SM-2 is
    input:  user grade q
            repetition number n
            easiness factor EF
            interval I
    output: updated values of n, EF, and I

    if q ≥ 3 (correct response) then
        if n = 0 then
            I ← 1
        else if n = 1 then
            I ← 6
        else
            I ← round(I × EF)
        end if
        increment n
    else (incorrect response)
        n ← 0
        I ← 1
    end if
    
    EF ← EF + (0.1 − (5 − q) × (0.08 + (5 − q) × 0.02))
    if EF < 1.3 then
        EF ← 1.3
    end if

    return (n, EF, I)

////////////////////////////

After all scheduled reviews are complete, SuperMemo asks the user to re-review
any cards they marked with a grade less than 4 repeatedly until they give a grade ≥ 4.
*/
function sm2(problem, q) {
  if (!q || q < 0) q = 0
  if (q > 5) q = 5

  let rd = new Date()

  if (q > 0) {
    if (q >= 3) {
      // correct response
      if (problem.n == 0) {
        problem.i = 1
      } else if (problem.n == 1) {
        problem.i = 6
      } else {
        problem.i = Math.round(problem.i * problem.ef)
      }
      problem.n++
    } // incorrect response
    else {
      problem.n = 0
      problem.i = 1
    }

    problem.q = q
    problem.ef = problem.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))

    if (problem.ef < 1.3) problem.ef = 1.3
    rd.setDate(rd.getDate() + problem.i)
  } else {
    // special case to skip the problem for today
    rd.setDate(rd.getDate() + 1)
  }

  problem.rd = date2string(rd)
}

function memoNext(q) {
  memoInitDB()

  if (!db) return

  if (problem) {
    sm2(problem, Number(q[q.length - 1]))
    stmt_update.run(
      problem.rd,
      problem.ef,
      problem.i,
      problem.n,
      problem.q,
      problem.id
    )
    console.log('=> ' + problem.rd + ' (' + problem.ef + ')')

    problems_stat.done++
  }

  let todo = db
    .prepare('SELECT COUNT(*) FROM problems WHERE rd <= ?')
    .bind(date2string(new Date()))
    .get()['COUNT(*)']

  let total = db.prepare('SELECT COUNT(*) FROM problems WHERE q < 4').get()[
    'COUNT(*)'
  ]

  problem = stmt_get_date.get()

  if (!problem) {
    if (!problems.length) {
      problems = stmt_get_q.all(4)
    }

    todo = problems.length
    problem = problems.shift()
  }

  console.log(problem)

  if (todo > 0) {
    windows[0].webContents.send('memo-todo', `${todo} (${total})`)
  } else {
    windows[0].webContents.send('memo-todo', 'All done')
  }

  if (problem)
    windows[0].webContents.send('load-file', join(problems_root, problem.id))
}

function memoRescan() {
  problem = undefined

  if (problems_file != setting.get('memo.db')) {
    memoCloseDB()
  }

  memoInitDB()

  if (!db) return

  let problems_added = 0

  let folders = [problems_root]

  while (folders.length > 0) {
    let folder = folders[0]

    for (let f of readdirSync(folder, {withFileTypes: true})) {
      if (f.isFile()) {
        if (f.name.toLowerCase().endsWith('.sgf')) {
          let fname = join(folder, f.name).slice(problems_root.length + 1)

          let res = db
            .prepare('INSERT OR IGNORE INTO problems(id) VALUES (?)')
            .run(fname)

          if (res.changes > 0) {
            problems_added++
            console.log(fname)
          }
        }
      } else if (f.isDirectory()) {
        folders.push(join(folders[0], f.name))
      }
    }

    folders.shift()
  }

  console.log(`${problems_added} new problems added`)
}

async function main() {
  app.allowRendererProcessReuse = true

  if (!setting.get('app.enable_hardware_acceleration')) {
    app.disableHardwareAcceleration()
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      memoCloseDB()
      app.quit()
    } else {
      buildMenu({disableAll: true})
    }
  })

  app.on('activate', (evt, hasVisibleWindows) => {
    if (app.isReady() && !hasVisibleWindows) newWindow()
  })

  app.on('open-file', (evt, path) => {
    evt.preventDefault()

    if (!app.isReady()) {
      openfile = path
    } else {
      newWindow(path)
    }
  })

  process.on('uncaughtException', err => {
    let t = i18n.context('exception')

    dialog.showErrorBox(
      t(p => `${p.appName} v${p.version}`, {
        appName: app.name,
        version: app.getVersion()
      }),
      t(
        p =>
          [
            `Something weird happened. ${p.appName} will shut itself down.`,
            `If possible, please report this on ${p.appName}’s repository on GitHub.`
          ].join(' '),
        {
          appName: app.name
        }
      ) +
        '\n\n' +
        err.stack
    )

    process.exit(1)
  })

  await app.whenReady()

  if (!openfile && process.argv.length >= 2) {
    if (!['electron.exe', 'electron'].some(x => process.argv[0].endsWith(x))) {
      openfile = process.argv[1]
    } else if (process.argv.length >= 3) {
      openfile = process.argv[2]
    }
  }

  newWindow(openfile)

  if (setting.get('app.startup_check_updates')) {
    setTimeout(
      () => checkForUpdates(),
      setting.get('app.startup_check_updates_delay')
    )
  }

  ipcMain.on('new-window', (evt, ...args) => newWindow(...args))
  ipcMain.on('build-menu', (evt, ...args) => buildMenu(...args))
  ipcMain.on('check-for-updates', (evt, ...args) => checkForUpdates(...args))
  ipcMain.on('memo-next', (evt, ...args) => memoNext(...args))
  ipcMain.on('memo-rescan', (evt, ...args) => memoRescan(...args))
}

main()

const webpack = require("webpack");
const authors = require("parse-authors");
const importFrom = require("import-from"); // used to get the users project details form their working dir
const reporter = require("./reporter-util"); // webpack stats formatters & helpers
const server = require("./server"); // client server
const fs = require("fs");

class Jarvis {
  constructor(opts = {}) {
    const currentWorkingDirectory = process.cwd();
    opts.host = opts.host || "localhost";
    opts.port = parseInt(opts.port || 1337, 10);
    opts.keepAlive = !!opts.keepAlive;
    opts.packageJsonPath = opts.packageJsonPath || currentWorkingDirectory;
    opts.watchOnly = opts.watchOnly !== false;

    if (opts.port && isNaN(opts.port)) {
      console.error(
        `[JARVIS] error: the specified port (${
          opts.port
        }) is invalid. Reverting to 1337`
      );
      opts.port = 1337;
    } else {
      console.log(`[JARVIS]`);
      console.dir(opts);
    }

    if (opts.packageJsonPath && !fs.existsSync(opts.packageJsonPath)) {
      console.warn(
        `[JARVIS] warning: the specified path (${
          opts.packageJsonPath
        }) does not exist. Falling back to ${currentWorkingDirectory}`
      ); //Fallback to cwd and warn
      opts.packageJsonPath = currentWorkingDirectory;
    }

    this.options = opts;

    let jarvisEnv = "production";
    if (process.env.JARVIS_ENV && process.env.JARVIS_ENV === "development") {
      jarvisEnv = "development";
    }

    this.env = {
      jarvisEnv: jarvisEnv,
      clientEnv: "development",
      running: false, // indicator if our express server + sockets are running
      watching: false
    };

    this.reports = {
      stats: {},
      progress: {},
      project: {}
    };

    this.pkg = importFrom(this.options.packageJsonPath, "./package.json");
  }

  apply(compiler) {
    console.log(`[JARVIS] Compiler Apply Called`);

    compiler.apply(new webpack.ProgressPlugin((percentage, message) => {
      this.reports.progress = {
        percentage,
        message
      };

      if (this.env.running) {
        this.server.io.emit("progress", {
          percentage,
          message
        });
      } else {
        this.boot(compiler)
      }
    }))

    compiler.hooks.afterEmit.tap('Jarvis', compilation => {
      const {
        name,
        version,
        author: makers
      } = this.pkg;

      const normalizedAuthor = parseAuthor(makers);

      this.reports.project = {
        name,
        version,
        makers: normalizedAuthor
      };


      // console.dir(compiler.options)

      // if (compiler.options && compiler.options.mode) {
      //   this.env.clientEnv = 'production';
      // }
    })

    compiler.hooks.watchRun.tapAsync('Jarvis', (compiler, callback) => {
      console.log('[JARVIS] watchRun event emitted');

      if (this.options.watchOnly) {
        this.env.watching = this.options.watchOnly;
      }
      callback();
    });

    compiler.hooks.run.tapAsync('Jarvis', (compiler, callback) => {
      console.log('[JARVIS] Run event emitted');

      callback();
    })

    // extract the final reports from the stats!
    compiler.hooks.done.tap('Jarvis', stats => {
      if (!this.env.running) {
        console.log('[JARVIS] Jarvis is not running');
      }

      const jsonStats = stats.toJson({
        chunkModules: true
      });

      jsonStats.isDev = this.env.clientEnv === "development";
      this.reports.stats = reporter.statsReporter(jsonStats);
      jarvis.io.emit("stats", this.reports.stats);
    });
  }

  boot(compiler) {
    let {
      port,
      host
    } = this.options;

    if (this.started) {
      console.log(`[JARVIS] ERROR: Already running on http://${host}:${port}`);
      return;
    }

    this.server = server.init(
      compiler,
      false
    );

    this.server.http.listen(port, host, _ => {
      console.log(`[JARVIS] Started dashboard on: http://${host}:${port}`);
      this.env.running = true;
      // if a new client is connected push current bundle info
      this.server.io.on("connection", socket => {
        socket.emit("project", this.reports.project);
        socket.emit("progress", this.reports.progress);
        socket.emit("stats", this.reports.stats);
      });
    });
  }
}

function parseAuthor(author) {
  if (author && author.name) return author;

  if (typeof author === "string") {
    const authorsArray = authors(author);
    if (authorsArray.length > 0) {
      return authorsArray[0];
    }
  }

  return {
    name: "",
    email: "",
    url: ""
  };
}

module.exports = Jarvis;

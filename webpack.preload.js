const path = require("path");

module.exports = {
  mode: "production",
  target: "electron-preload",
  entry: "./preload.cjs",
  output: {
    filename: "index.js",
    path: path.resolve(__dirname, "dist/preload"),
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: "ts-loader",
            options: {
              transpileOnly: true,
              onlyCompileBundledFiles: true,
              compilerOptions: {
                module: "CommonJS",
              },
            },
          },
        ],
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  externals: {
    electron: "commonjs2 electron",
    "electron-log": "commonjs2 electron-log",
  },
  stats: {
    errorDetails: false,
  },
  node: {
    __dirname: false,
    __filename: false,
  },
};

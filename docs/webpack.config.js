const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const MonacoWebpackPlugin = require("monaco-editor-webpack-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");

module.exports = {
  entry: "./src/index.js",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "app.bundle.js",
  },
  resolve: {
    extensions: [".js", ".json"],
    alias: {
      fs: require.resolve("./fs.js"),
    },
  },
  devServer: {
    contentBase: path.join(__dirname, "dist"),
    compress: true,
    port: 9000,
    clientLogLevel: "info",
  },
  resolveLoader: {
    modules: ["node_modules", path.resolve(__dirname, "loaders")],
  },
  module: {
    rules: [
      {
        test: /\.(js)x?$/,
        exclude: /node_modules/,
        loader: "babel-loader",
        options: {
          plugins: [["../build", { runtime: "inline" }]],
        },
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader?modules=true"],
      },
      {
        test: /\.(png|woff|woff2|eot|ttf|svg)$/,
        use: ["url-loader?limit=100000"],
      },
    ],
  },
  plugins: [
    new CleanWebpackPlugin(),
    new MonacoWebpackPlugin(),
    new HtmlWebpackPlugin({ template: "./src/assets/index.html" }),
  ],
};

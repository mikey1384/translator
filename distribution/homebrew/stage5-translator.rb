cask "stage5-translator" do
  arch arm: "arm64", intel: "x64"

  version "1.16.28"
  sha256 arm:   "66816e9076257e5e027592332d6238086a410664edcf647a9476491956da0121",
         intel: "9eb4a7a148bced6d1e8385e94d8f26d7d3afde34af02993a32e70daf2039c817"

  url "https://github.com/mikey1384/translator/releases/download/v#{version}/Translator-#{version}-darwin-#{arch}.zip",
      verified: "github.com/mikey1384/translator/"
  name "Translator"
  desc "Video discovery, subtitle translation, editing, dubbing, and export workstation"
  homepage "https://translator.tools/"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :monterey

  app "Translator.app"
end

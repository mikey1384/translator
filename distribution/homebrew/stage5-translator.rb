cask "stage5-translator" do
  arch arm: "arm64", intel: "x64"

  version "1.16.6"
  sha256 arm:   "34d83a142b1355a94412a8961cbe7b1d1bd00a442d57282d85b1c042154451ae",
         intel: "c243928db00297e380242b45ba4709cc3878d88d3b28582cfbf881e2f8b5e0f4"

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

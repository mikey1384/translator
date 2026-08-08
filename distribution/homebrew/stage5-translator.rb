cask "stage5-translator" do
  arch arm: "arm64", intel: "x64"

  version "1.16.5"
  sha256 arm:   "a6bca4aa7cbcd972638da5060d316ce627c1c2f39285e3c9ca81ef65d55ff70c",
         intel: "80057debd3ebfd3fc30a1360421c824e8cfb1b17ac81b6d72a33c0c10a241166"

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

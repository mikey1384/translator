cask "stage5-translator" do
  arch arm: "arm64", intel: "x64"

  version "1.16.25"
  sha256 arm:   "8155cbd75918b30641bc28dac38288ba41794ed2eebe646de3bc7a14919ab965",
         intel: "169d04102d7ce013686240c1ec1afc503240a699ac256b22ace40d8428533a0d"

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

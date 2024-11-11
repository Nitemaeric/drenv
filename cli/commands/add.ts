import { ensureDir } from "@std/fs"

export default async function add(recipe: string) {
  switch (recipe) {
    case "foodchain":
      return foodchain();
    default:
      throw new Error(`Unknown recipe: ${recipe}`);
  }
}

const foodchain = async () => {
  console.log("Installing foodchain...")

  const foodchainUrl = "https://raw.githubusercontent.com/pvande/foodchain/refs/heads/main/foodchain.rb"

  const response = await fetch(foodchainUrl)
  const foodchainText = await response.text()

  await ensureDir("mygame/vendor/pvande/foodchain")
  await Deno.writeTextFile("mygame/vendor/pvande/foodchain/foodchain.rb", foodchainText)
  await Deno.writeTextFile("mygame/dependencies.rb", "require \"vendor/pvande/foodchain/foodchain.rb\"\n")
}

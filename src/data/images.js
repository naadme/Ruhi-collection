// All photography is centralised here. Replace any URL with your own hosted photo or a file in /public/images.
const u = (id, w = 900) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`
export const img = {
  heroMen: u('1602810318383-e386cc2a3ccf', 1100), heroWomenTop: u('1509631179647-0177331693ae', 900), heroStore: u('1441984904996-e0b6ba687e04', 900),
  story: u('1490481651871-ab68de25d43d', 1200), aboutHero: u('1445205170230-053b83016050', 1600), aboutA: u('1558769132-cb1aea458c5e', 900), aboutB: u('1523381210434-271e8be1f52b', 900),
  contact: u('1441984904996-e0b6ba687e04', 2000),
  catWomenPant: u('1541099649105-f69ad21f3246', 500), catMenPant: u('1542272604-787c3835535d', 500), catShirt: u('1596755094514-f87e34085b2c', 500), catTshirt: u('1503342217505-b0a15ec3261c', 500),
  r1: u('1607345366928-199ea26cfe3e', 700), r2: u('1473966968600-fa801b869a1a', 700), r3: u('1469334031218-e382a71b716b', 700), r4: u('1434389677669-e08b4cac3105', 700),
}
export { u }

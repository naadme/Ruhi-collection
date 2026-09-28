// Edit products here. Images live in /public/images/products (swap .svg for .jpg/.png as needed).
import { u, img } from './images'
const base = { badge: 'Bestseller', sizes: ['S', 'M', 'L', 'XL'], desc: 'Soft, breathable fabric with a comfortable everyday fit. Machine washable; colour stays true after repeated washes.' }
const A = {
  'men-shirt-1': ['1596755094514-f87e34085b2c', '1602810318383-e386cc2a3ccf'], 'men-shirt-2': ['1607345366928-199ea26cfe3e', '1596755094514-f87e34085b2c'],
  'men-shirt-3': ['1552374196-1ab2a1c593e8', '1489987707025-afc232f7ea0f'], 'men-shirt-4': ['1489987707025-afc232f7ea0f', '1552374196-1ab2a1c593e8'],
  'men-pant-1': ['1473966968600-fa801b869a1a', '1542272604-787c3835535d'], 'men-pant-2': ['1542272604-787c3835535d', '1473966968600-fa801b869a1a'],
  'men-pant-3': ['1624378439575-d8705ad7ae80', '1507679799987-c73779587ccf'], 'men-pant-4': ['1507679799987-c73779587ccf', '1624378439575-d8705ad7ae80'],
  'women-tshirt-1': ['1503342217505-b0a15ec3261c', '1509631179647-0177331693ae'], 'women-tshirt-2': ['1583743814966-8936f5b7be1a', '1503342217505-b0a15ec3261c'],
  'women-tshirt-3': ['1434389677669-e08b4cac3105', '1509631179647-0177331693ae'], 'women-tshirt-4': ['1509631179647-0177331693ae', '1434389677669-e08b4cac3105'],
  'women-pant-1': ['1541099649105-f69ad21f3246', '1469334031218-e382a71b716b'], 'women-pant-2': ['1469334031218-e382a71b716b', '1541099649105-f69ad21f3246'],
  'women-pant-3': ['1483985988355-763728e1935b', '1529139574466-a303027c1d8b'], 'women-pant-4': ['1529139574466-a303027c1d8b', '1483985988355-763728e1935b'],
}
const p = (id, gender, type, title, price, rating, reviews, compare) => ({ ...base, id, gender, type, title, price, compare, rating, reviews, image: u(A[id][0], 900), hover: u(A[id][1], 900) })
export const products = [
  p('men-shirt-1', 'men', 'shirt', "Men's Caudrauy Co-Ord Set Black", 899, 4.8, 223, 999),
  p('men-shirt-2', 'men', 'shirt', "Men's Shirt", 799, 4.9, 346),
  p('men-shirt-3', 'men', 'shirt', "Men's Printed Spread Collar Casual Shirt Navy Blue", 599, 5.0, 469),
  p('men-shirt-4', 'men', 'shirt', "Men's Printed Spread Collar Casual Shirt Multicolor", 599, 5.1, 592),
  p('men-pant-1', 'men', 'pant', "Men's Caudray Fabric Stylish Pants", 499, 4.8, 223),
  p('men-pant-2', 'men', 'pant', "Men's White Baggy Fit Pants", 699, 4.9, 346),
  p('men-pant-3', 'men', 'pant', "Men's Slim Fit Formal Pants", 599, 5.0, 469),
  p('men-pant-4', 'men', 'pant', "Men's Cargo Casual Pants", 599, 5.1, 592),
  p('women-tshirt-1', 'women', 'tshirt', 'Ketex Yellow Cotton Blend Polo Neck Tshirt', 699, 4.8, 223),
  p('women-tshirt-2', 'women', 'tshirt', 'Ketex White Cotton Blend Polo Neck Tshirt', 599, 4.9, 346),
  p('women-tshirt-3', 'women', 'tshirt', 'Ketex Sky Blue Cotton Blend Polo Neck Tshirt', 499, 5.0, 469),
  p('women-tshirt-4', 'women', 'tshirt', 'Ketex Royal Blue Cotton Blend Polo Neck Tshirt', 499, 5.1, 592),
  p('women-pant-1', 'women', 'pant', "Women's Classic Stylish Pant Pink", 699, 4.8, 223),
  p('women-pant-2', 'women', 'pant', "Women's High Waist Wide Leg Pant White", 699, 4.9, 346),
  p('women-pant-3', 'women', 'pant', "Women's Straight Fit Pant Black", 599, 5.0, 469),
  p('women-pant-4', 'women', 'pant', "Women's Relaxed Fit Pant Beige", 599, 5.1, 592),
]
export const getProduct = (id) => products.find((x) => x.id === id)
export const collections = [
  { key: 'men', title: "Men's Collection", subtitle: 'Elevate Your Look with Men’s Wear', tabs: [['shirt', 'Shirt'], ['pant', 'Pant']] },
  { key: 'women', title: "Women's Collection", subtitle: 'Unfold Your Style — Women’s Wear', tabs: [['tshirt', 'T shirt'], ['pant', 'Pant']] },
]
export const categories = [
  { label: "Women's pants", image: img.catWomenPant, to: '/shop?gender=women&type=pant' },
  { label: "Men's pants", image: img.catMenPant, to: '/shop?gender=men&type=pant' },
  { label: 'Shirts', image: img.catShirt, to: '/shop?type=shirt' },
  { label: 'T-shirts', image: img.catTshirt, to: '/shop?type=tshirt' },
]
export const reviews = [
  { name: 'Rohit', img: img.r1, product: 'men-shirt-3', title: "Men's Printed Half Sleeves Regular Collar Casual Shirt", price: 599, text: "The shirt quality is amazing, fabric feels soft and the fitting is just perfect. Even after 2 washes, the color didn't fade. Perfect for daily wear" },
  { name: 'Amit', img: img.r2, product: 'men-pant-1', title: "Men's Caudray Fabric Stylish Pants", price: 499, text: 'The fabric is stretchable and very comfortable. I use it for both office and casual wear. Stitching is strong and the size was accurate. Worth the money' },
  { name: 'Neha', img: img.r3, product: 'women-pant-1', title: "Women's Classic Stylish Pant Pink", price: 699, text: 'These pants are super comfortable, skin-friendly material, and stylish fitting. Looks great with both jeans and tops. Definitely recommend!' },
  { name: 'Priya', img: img.r4, product: 'women-tshirt-1', title: 'Ketex Maroon Cotton Blend Polo Neck Tshirt', price: 499, text: 'The T-shirt design is trendy and the cotton fabric is really soft. Feels light and comfortable even in summer. Loved the colors as well' },
]
export const collectionTiles = [
  { title: "Men's Shirts", text: 'Printed, casual and co-ord sets', image: products[0].image, to: '/shop?gender=men&type=shirt' },
  { title: "Men's Pants", text: 'Relaxed and tailored fits', image: products[4].image, to: '/shop?gender=men&type=pant' },
  { title: "Women's Tops", text: 'Polo tees in every colour', image: products[8].image, to: '/shop?gender=women&type=tshirt' },
  { title: "Women's Pants", text: 'Wide-leg and straight cuts', image: products[12].image, to: '/shop?gender=women&type=pant' },
]

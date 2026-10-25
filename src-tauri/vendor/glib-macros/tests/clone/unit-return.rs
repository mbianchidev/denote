// Take a look at the license at the top of the repository in the LICENSE file.

#![deny(warnings)]

use glib::clone;

fn main() {
    let v = std::rc::Rc::new(1);
    let _ = clone!(@weak v => @default-return (), move || println!("{}", v););
    let _ = clone!(@weak v => @default-return (()), move || println!("{}", v););
    let _ = clone!(@weak v => @default-return ( () ), move || println!("{}", v););
    let _ = clone!(@weak v => @default-return (  ), move || println!("{}", v););
}

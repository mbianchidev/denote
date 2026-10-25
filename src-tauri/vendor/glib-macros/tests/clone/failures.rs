// Take a look at the license at the top of the repository in the LICENSE file.

use glib::clone;

fn main() {
    let v = std::rc::Rc::new(1);
    clone!( => move || {});
    clone!(|| {});
    clone!(|a, b| {});
    clone!(@weak a, @weak b => |x| {});
    clone!(@weak a, @weak b => || {});
    clone!(@weak a, @weak b => |x| println!("a"));
    clone!(@weak a, @weak b => || println!("a"));
    clone!(@weak a => |x| {});
    clone!(@weak a => || {});
    clone!(@weak a => |x| println!("a"));
    clone!(@weak a => || println!("a"));
    clone!(@strong self => move |x| {});
    clone!(@strong self.v => move |x| {});
    clone!(@weak v => @default-return false, || {});
    clone!(@weak v => @default-return false, || println!("a"));
    clone!(@weak v => @default-return false, |bla| {});
    clone!(@weak v => @default-return false, |bla| println!("a"));
    clone!(@weak v => default-return false, move || {});
    clone!(@weak v => @default-return false move || {});
    clone!(@yolo v => move || {});
    clone!(v => move || {});
    clone!(@strong v => {println!("foo");});
    clone!(@strong v, @default-return lol => move || {println!("foo");});
    clone!(@default-return lol, @strong v => move || {println!("foo");});
    clone!(@strong v => async || {println!("foo");});
    clone!(@strong v => async {println!("foo");});
    clone!(@strong v => move || async {println!("foo");});
    clone!(@strong v => move || async println!("foo"););
    clone!(@strong v => move || async move println!("foo"););
}

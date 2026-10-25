// Take a look at the license at the top of the repository in the LICENSE file.

use std::rc::Rc;

use glib::clone;

#[test]
fn clone() {
    let v = Rc::new(1);
    let _ = clone!(@strong v => @default-return None::<i32>, move || {println!("foo"); 1});

    let v = Rc::new(1);
    let _ = clone!(@weak v => @default-return None::<i32>, move || {println!("foo"); Some(1)});

    let v = "123";
    let _ = clone!(@to-owned v => @default-return None::<i32>, move || {println!("foo"); 1});
}

#[test]
fn clone_failures() {
    trybuild::TestCases::new().compile_fail("tests/clone/failures.rs");
}

#[test]
fn clone_unit_tuple_return() {
    trybuild::TestCases::new().pass("tests/clone/unit-return.rs");
}

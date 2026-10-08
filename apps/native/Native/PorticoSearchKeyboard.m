#import <React/RCTViewManager.h>
#import <React/RCTComponent.h>
#import <React/UIView+React.h>
#import <UIKit/UIKit.h>

/**
 * Justin's rule: the platform's own keyboard, with dictation. On Apple TV that is the system
 * search experience: a `UISearchController` inside a `UISearchContainerViewController`, whose
 * inline keyboard brings Siri Remote dictation and the "Use your iPhone to enter text" prompt.
 * The container is embedded as a child view controller of the React screen; its text is sent to
 * JavaScript (`onChangeText`), which runs the search service and draws the results underneath.
 * Its results controller is an empty placeholder: React Native renders the results.
 */
@interface PorticoSearchKeyboardView : UIView <UISearchResultsUpdating>
@property (nonatomic, copy) RCTDirectEventBlock onChangeText;
@property (nonatomic, copy) NSString *placeholder;
@end

@implementation PorticoSearchKeyboardView {
  UISearchController *_search;
  UISearchContainerViewController *_container;
  NSString *_last;
}

- (instancetype)initWithFrame:(CGRect)frame {
  if ((self = [super initWithFrame:frame])) {
    // tvOS requires a results controller; ours is empty and transparent (React Native draws the
    // results below this view).
    UIViewController *results = [UIViewController new];
    results.view.backgroundColor = UIColor.clearColor;
    results.view.userInteractionEnabled = NO;
    _search = [[UISearchController alloc] initWithSearchResultsController:results];
    _search.searchResultsUpdater = self;
    _search.obscuresBackgroundDuringPresentation = NO;
    _search.hidesNavigationBarDuringPresentation = NO;
    _container = [[UISearchContainerViewController alloc] initWithSearchController:_search];
    _last = @"";
  }
  return self;
}

- (void)attach {
  UIViewController *parent = self.reactViewController;
  if (!parent || _container.parentViewController == parent) return;
  [parent addChildViewController:_container];
  _container.view.frame = self.bounds;
  _container.view.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  _container.view.backgroundColor = UIColor.clearColor;
  [self addSubview:_container.view];
  [_container didMoveToParentViewController:parent];
}

- (void)detach {
  if (!_container.parentViewController) return;
  [_container willMoveToParentViewController:nil];
  [_container.view removeFromSuperview];
  [_container removeFromParentViewController];
}

- (void)didMoveToWindow {
  [super didMoveToWindow];
  if (self.window) [self attach];
  else [self detach];
}

- (void)layoutSubviews {
  [super layoutSubviews];
  _container.view.frame = self.bounds;
}

- (void)updateSearchResultsForSearchController:(UISearchController *)searchController {
  NSString *text = searchController.searchBar.text ?: @"";
  if ([text isEqualToString:_last]) return;
  _last = text;
  if (self.onChangeText) self.onChangeText(@{@"text": text});
}

- (void)setPlaceholder:(NSString *)placeholder {
  _placeholder = [placeholder copy];
  _search.searchBar.placeholder = placeholder;
}

@end

@interface PorticoSearchKeyboardManager : RCTViewManager
@end

@implementation PorticoSearchKeyboardManager
RCT_EXPORT_MODULE(PorticoSearchKeyboard)
- (UIView *)view { return [PorticoSearchKeyboardView new]; }
RCT_EXPORT_VIEW_PROPERTY(onChangeText, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(placeholder, NSString)
@end

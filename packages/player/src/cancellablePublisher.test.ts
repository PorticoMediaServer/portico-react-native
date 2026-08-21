import {createCancellablePublisher} from './cancellablePublisher';

test('pending native state cannot publish after subscription cleanup', () => {
  const listener = jest.fn();
  const publisher = createCancellablePublisher(listener);
  publisher.cancel();
  publisher.publish('late-state');
  expect(listener).not.toHaveBeenCalled();
});

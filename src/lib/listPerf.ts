/**
 * Props de virtualización compartidas para FlatList. Hacen el scroll más fluido
 * y reducen memoria en listas largas (favoritos, explorar, cola) sin cambiar el
 * comportamiento: solo controlan cuántos elementos se montan a la vez.
 */
export const listPerf = {
  removeClippedSubviews: true,
  initialNumToRender: 10,
  maxToRenderPerBatch: 10,
  windowSize: 11,
};

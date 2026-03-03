type Props = {
  cardId: string;
  alt: string;
  compact?: boolean;
};

export function CardImage({ cardId, alt, compact = false }: Props) {
  const src = `/assets/cards/${cardId}.png`;
  const cls = compact ? "card-image compact" : "card-image";
  return (
    <img
      className={cls}
      src={src}
      alt={alt}
      onError={(event) => {
        event.currentTarget.src = "/assets/cards/placeholder.png";
      }}
      loading="lazy"
    />
  );
}

